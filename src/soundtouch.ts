/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { EventEmitter } from "events";
import { Bosesoundtouchadapter } from "./main";
import * as xml2js from "xml2js";
import { Builder } from "xml2js";
import WebSocket from "ws";
import axios, { AxiosRequestConfig } from "axios"
import format from "string-format";

export interface IDevice {
    ip: string,
    mac: string
}

export class soundtouchsocket extends EventEmitter {
    address: string;
    adapter: Bosesoundtouchadapter;
    js2xml: Builder;
    ws: WebSocket;
    heartBeatInterval: NodeJS.Timeout | undefined;
    private _lastMessage = 0;

    constructor(adapter: Bosesoundtouchadapter) {
        super();
        this.address = (adapter.config as any).address;
        if (!this.address) {
            throw new Error("soundtouchsocket needs an address");
        }
        const address = "ws://" + this.address + ":8080/";
        this.ws = new WebSocket(address, "gabbo");

        this.adapter = adapter;
        // this.request = require('request');
        // this.promise = require('es6-promise');
        // this.xml2js = require('xml2js');
        this.js2xml = new xml2js.Builder({ headless: true, rootName: "ContentItem", renderOpts: { pretty: false } });
    }

    connect() {
        this.adapter.log.debug("connect");

        return new Promise<void>((resolve, reject) => {
            this.adapter.log.info("connecting to host " + this.ws.url);

            this.ws.on("open", () => this._onOpen(resolve));
            this.ws.on("close", () => this._onClose());
            this.ws.on("error", (error) => { this._onError(error, reject); });
            this.ws.on("message", (data: any, flags: any) => { this._onMessage(data, flags); });

        });
    }

    _heartBeatFunc() {
        this.adapter.log.debug("_heartBeatFunc");
        if (Date.now() - this._lastMessage > 30000) {
            this.adapter.log.warn("heartbeat timeout");
            this.ws.close();
            this.clearHearthBeat();
        }
        else {
            //this.adapter.log.debug('<span style="color:darkblue;">sending heartbeat');
            this.send("webserver/pingRequest");
        }
    }

    _restartHeartBeat() {
        this.adapter.log.debug("_restartHeartBeat");
        this._lastMessage = Date.now();

        this.clearHearthBeat();
        this.heartBeatInterval = setInterval(() => { this._heartBeatFunc(); }, 10000);
    }

    clearHearthBeat() {
        if (this.heartBeatInterval) {
            clearInterval(this.heartBeatInterval);
        }
    }

    _onOpen(resolve: () => void) {
        this.adapter.log.debug("onOpen");
        this._restartHeartBeat();
        this.emit("connected");
        resolve();
    }

    _onClose() {
        this.adapter.log.debug("onClose");
        this.clearHearthBeat()
        this.emit("closed");
    }

    _onError(error: Error, reject: () => void) {
        this.adapter.log.error("websocket error " + error);
        this.emit("error", error);
        reject();
    }

    _onMessage(data: string, flags: any) {
        this.adapter.log.debug("onMessage" + flags);
        this._parse(data);
    }

    send(data: any) {
        return new Promise<void>((resolve, reject) => {
            this.adapter.log.debug("Send: " + data);
            this.ws.send(data, function ackSend(err) {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
    }

    _handleVolume(volume: any) {
        this.adapter.log.debug("received [volume]:" + volume.actualvolume);
        const obj = {
            volume: volume.actualvolume,
            muted: volume.muteenabled == "true"
        };
        this.emit("volume", obj);
    }

    _handlePresets(data: any) {
        const object: { source: string, name: string, iconUrl: string }[] = [];
        for (let i = 0; i < 6; i++) {
            object[i] = {
                source: "",
                name: "",
                iconUrl: ""
            };
        }
        if (data.presets) {
            this.adapter.log.debug("received [presets]:" + JSON.stringify(data.presets));
            if (data.presets.preset) {
                const presets = data.presets.preset;
                let contentItem;
                let id;
                if (Array.isArray(presets)) {
                    presets.forEach(i => {
                        contentItem = presets[i].ContentItem;
                        id = presets[i].$.id - 1;
                        object[id].source = contentItem.$.source;
                        object[id].name = contentItem.itemName;
                        object[id].iconUrl = contentItem.containerArt;
                    })
                }
                else {
                    contentItem = presets.ContentItem;
                    id = presets.$.id - 1;
                    object[id].source = contentItem.$.source;
                    object[id].name = contentItem.itemName;
                    object[id].iconUrl = contentItem.containerArt;
                }
            }
        }
        this.emit("presets", object);
    }

    _handleSources(data: any) {
        this.adapter.log.debug("received [sources]:" + JSON.stringify(data.sourceItem));
        const object = [];
        for (const i in data.sourceItem) {
            const source = data.sourceItem[i].$;
            object.push({
                name: source.source,
                sourceAccount: source.sourceAccount,
                isLocal: source.isLocal == "true",
                multiRoomAllowed: source.multiroomallowed,
                status: source.status
            });
        }
        this.emit("sources", object);
    }

    _handleDeviceInfo(data: any) {
        this.adapter.log.debug("received [info] " + JSON.stringify(data));
        let networkInfo;
        if (Array.isArray(data.networkInfo)) {
            networkInfo = data.networkInfo[0];
        }
        else {
            networkInfo = data.networkInfo;
        }
        const object = {
            name: data.name,
            type: data.type,
            macAddress: data.$.deviceID,
            ipAddress: networkInfo.ipAddress
        };
        this.emit("deviceInfo", object);
    }

    _handleNowPlaying(data: any) {
        this.adapter.log.debug("received [now_playing] " + JSON.stringify(data));
        const object = {
            source: data.$.source,
            track: "",
            artist: "",
            album: "",
            station: "",
            art: "",
            genre: "",
            time: "",
            total: "",
            playStatus: "",
            repeatStatus: "",
            shuffleStatus: "",
            contentItem: null,
            repeatSetting: "",
            shuffleSetting: "",
        };
        switch (data.$.source) {
            case "AMAZON":
            case "BLUETOOTH":
            case "INTERNET_RADIO":
            case "SPOTIFY":
            case "DEEZER":
            case "STORED_MUSIC":
            case "TUNEIN":
                object.track = data.track;
                object.artist = data.artist;
                object.album = data.album;
                object.station = data.stationName;
                if (data.art && data.art._) {
                    object.art = data.art._;
                }
                if (data.genre) {
                    object.genre = data.genre;
                }
                if (data.ContentItem) {
                    object.contentItem = data.ContentItem;
                }
                if (data.time && data.time._) {
                    object.time = data.time._;
                }
                if (data.time && data.time.$ && data.time.$.total) {
                    object.total = data.time.$.total;
                }
                object.playStatus = data.playStatus;
                if (data.repeatSetting) {
                    object.repeatSetting = data.repeatSetting;
                }
                if (data.shuffleSetting) {
                    object.shuffleSetting = data.shuffleSetting;
                }
                break;

            case "PRODUCT":
                object.station = data.$.sourceAccount;
                break;
        }

        this.emit("nowPlaying", object);
    }

    _handleZone(data: any) {
        this.emit("zones", data);
    }

    _onJsData(jsData: any) {
        this.adapter.log.debug(JSON.stringify(jsData));
        for (const infoItem in jsData) {
            switch (infoItem) {
                case "info":
                    this._handleDeviceInfo(jsData[infoItem]);
                    break;

                case "nowPlaying":
                    this._handleNowPlaying(jsData[infoItem]);
                    break;

                case "bass":
                    this._handleBassInfo(jsData[infoItem]);
                    break;

                case "bassCapabilities":
                    this._handleBassCaps(jsData[infoItem]);
                    break;

                case "volume": {
                    const volume = jsData.volume;
                    if (volume) {
                        this._handleVolume(volume);
                    }
                    break;
                }

                case "presets":
                    this._handlePresets(jsData);
                    break;

                case "sources":
                    this._handleSources(jsData[infoItem]);
                    break;

                case "zone":
                    this._handleZone(jsData[infoItem]);
                    break;

                case "trackInfo":
                    this._handleTrackInfo(jsData[infoItem]);
                    break;

                case "updates":
                    if (jsData.hasOwnProperty("updates")) {
                        for (const updateItem in jsData.updates) {
                            switch (updateItem) {
                                case "nowPlayingUpdated": {
                                    const nowPlaying = jsData.updates.nowPlayingUpdated.nowPlaying;
                                    if (nowPlaying) {
                                        this._handleNowPlaying(nowPlaying);
                                    }
                                    else {
                                        this.getInfo();
                                    }
                                    break;
                                }

                                case "volumeUpdated": {
                                    const vol = jsData.updates.volumeUpdated.volume;
                                    if (vol) {
                                        this._handleVolume(vol);
                                    }
                                    else {
                                        this.getVolume();
                                    }
                                    break;
                                }

                                case "zoneUpdated": {
                                    this._handleZone(jsData.updates.zoneUpdated.zone);
                                    break;
                                }

                            }
                        }
                    }
                    break;
            }
        }

        this._restartHeartBeat();
    }
    getInfo() {
        /* not implemnted*/
    }

    private _handleTrackInfo(_arg0: any) {
        /* not implemnted*/
    }
    private _handleBassCaps(_arg0: any) {
        /* not implemnted*/
    }
    private _handleBassInfo(_arg0: any) {
        /* not implemnted*/
    }

    _parse(xml: string) {
        xml2js.parseString(xml, { explicitArray: false }, (err, jsData) => {
            if (err) {
                this.adapter.log.error(JSON.stringify(err));
            }
            else {
                this._onJsData(jsData);
            }
        });
    }

    async _post(command: string, bodyString: string) {
        const options: AxiosRequestConfig = {
            method: "post",
            url: `http://${this.address}:8090/${command}`,
            data: bodyString
        };
        this.adapter.log.debug(`_post: ${options.url}, ${options.data}`);
        await axios(options)
            .then(() => {
                /* */
            }).catch((error) => {
                if (typeof error === "string") {
                    this.adapter.log.error(error);
                } else {
                    this.adapter.log.error(JSON.stringify(error));
                }

            });
    }

    setValue(command: string, args: string, value: string) {
        if (args !== "" && args[0] != " ") {
            args = " " + args;
        }
        const bodyString = "<" + command + args + ">" + value + "</" + command + ">";
        this._post(command, bodyString);
    }

    createZone(master: IDevice, slaves: IDevice[]) {
        const body = '<zone master="{}"> {} </zone>';
        const member = '<member ipaddress="{}">{}</member>';

        let members = "";
        slaves.forEach(slave => {
            members = members + format(member, slave.ip, slave.mac);
        });
        const str = format(body, master.mac, members);
        this._post("setZone", str);
    }

    addZoneSlave(master: IDevice, slave: IDevice, socket: soundtouchsocket) {
        const body = '<zone master="{}"> {} </zone>';
        const member = `<member ipaddress="${slave.ip}">${slave.mac}</member>`;
        const str = format(body, master.mac, member);
        return socket._post("addZoneSlave", str);
    }

    removeZoneSlave(master: IDevice, slave: IDevice, socket: soundtouchsocket) {
        const body = '<zone master="{}"> {} </zone>';
        const member = `<member ipaddress="${slave.ip}">${slave.mac}</member>`;
        const str = format(body, master.mac, member);
        return socket._post("removeZoneSlave", str);
    }

    playSource(source: string, sourceAccount: string, contentItem: string) {
        let str;
        if (contentItem) {
            str = this.js2xml.buildObject(contentItem);
        }
        else {
            const body = '<ContentItem source="{}" sourceAccount="{}"></ContentItem>';
            str = format(body, source, sourceAccount);
        }
        return this._post("select", str);
    }

    async get(value: string) {
        const command = `http://${this.address}:8090/${value}`;
        this.adapter.log.debug("request: " + command);

        await axios({ method: "GET", url: command })
            .then(body => this._parse(body.data)
            ).catch(error => this.adapter.log.error(error));
    }

    getDeviceInfo() {
        this.get("info");
    }

    getPlayInfo() {
        this.get("now_playing");
    }

    getPresets() {
        this.get("presets");
    }

    getVolume() {
        this.get("volume");
    }

    getSources() {
        this.get("sources");
    }

    getZone() {
        this.get("getZone");
    }

    updateAll() {
        this.adapter.log.debug("updateAll");
        return Promise.all([
            this.getDeviceInfo(),
            this.getPlayInfo(),
            this.getPresets(),
            //this.getBassCapabilities(),
            //this.getBassInfo(),
            this.getVolume(),
            this.getSources(),
            this.getZone(),
            //this.getTrackInfo()
        ]);
    }

}
