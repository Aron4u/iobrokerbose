"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.soundtouchsocket = void 0;
/* eslint-disable @typescript-eslint/explicit-function-return-type */
const events_1 = require("events");
const xml2js = __importStar(require("xml2js"));
const ws_1 = __importDefault(require("ws"));
const axios_1 = __importDefault(require("axios"));
const string_format_1 = __importDefault(require("string-format"));
class soundtouchsocket extends events_1.EventEmitter {
    constructor(adapter) {
        super();
        this._lastMessage = 0;
        this.address = adapter.config.address;
        if (!this.address) {
            throw new Error("soundtouchsocket needs an address");
        }
        const address = "ws://" + this.address + ":8080/";
        this.ws = new ws_1.default(address, "gabbo");
        this.adapter = adapter;
        // this.request = require('request');
        // this.promise = require('es6-promise');
        // this.xml2js = require('xml2js');
        this.js2xml = new xml2js.Builder({ headless: true, rootName: "ContentItem", renderOpts: { pretty: false } });
    }
    connect() {
        this.adapter.log.debug("connect");
        return new Promise((resolve, reject) => {
            this.adapter.log.info("connecting to host " + this.ws.url);
            this.ws.on("open", () => this._onOpen(resolve));
            this.ws.on("close", () => this._onClose());
            this.ws.on("error", (error) => { this._onError(error, reject); });
            this.ws.on("message", (data, flags) => { this._onMessage(data, flags); });
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
    _onOpen(resolve) {
        this.adapter.log.debug("onOpen");
        this._restartHeartBeat();
        this.emit("connected");
        resolve();
    }
    _onClose() {
        this.adapter.log.debug("onClose");
        this.clearHearthBeat();
        this.emit("closed");
    }
    _onError(error, reject) {
        this.adapter.log.error("websocket error " + error);
        this.emit("error", error);
        reject();
    }
    _onMessage(data, flags) {
        this.adapter.log.debug("onMessage" + flags);
        this._parse(data);
    }
    send(data) {
        return new Promise((resolve, reject) => {
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
    _handleVolume(volume) {
        this.adapter.log.debug("received [volume]:" + volume.actualvolume);
        const obj = {
            volume: volume.actualvolume,
            muted: volume.muteenabled == "true"
        };
        this.emit("volume", obj);
    }
    _handlePresets(data) {
        const object = [];
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
                    });
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
    _handleSources(data) {
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
    _handleDeviceInfo(data) {
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
    _handleNowPlaying(data) {
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
    _handleZone(data) {
        this.emit("zones", data);
    }
    _onJsData(jsData) {
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
    _handleTrackInfo(_arg0) {
        /* not implemnted*/
    }
    _handleBassCaps(_arg0) {
        /* not implemnted*/
    }
    _handleBassInfo(_arg0) {
        /* not implemnted*/
    }
    _parse(xml) {
        xml2js.parseString(xml, { explicitArray: false }, (err, jsData) => {
            if (err) {
                this.adapter.log.error(JSON.stringify(err));
            }
            else {
                this._onJsData(jsData);
            }
        });
    }
    async _post(command, bodyString) {
        const options = {
            method: "post",
            url: `http://${this.address}:8090/${command}`,
            data: bodyString
        };
        this.adapter.log.debug(`_post: ${options.url}, ${options.data}`);
        await axios_1.default(options)
            .then(() => {
            /* */
        }).catch((error) => {
            if (typeof error === "string") {
                this.adapter.log.error(error);
            }
            else {
                this.adapter.log.error(JSON.stringify(error));
            }
        });
    }
    setValue(command, args, value) {
        if (args !== "" && args[0] != " ") {
            args = " " + args;
        }
        const bodyString = "<" + command + args + ">" + value + "</" + command + ">";
        this._post(command, bodyString);
    }
    createZone(master, slaves) {
        const body = '<zone master="{}"> {} </zone>';
        const member = '<member ipaddress="{}">{}</member>';
        let members = "";
        slaves.forEach(slave => {
            members = members + string_format_1.default(member, slave.ip, slave.mac);
        });
        const str = string_format_1.default(body, master.mac, members);
        this._post("setZone", str);
    }
    addZoneSlave(master, slave, socket) {
        const body = '<zone master="{}"> {} </zone>';
        const member = `<member ipaddress="${slave.ip}">${slave.mac}</member>`;
        const str = string_format_1.default(body, master.mac, member);
        return socket._post("addZoneSlave", str);
    }
    removeZoneSlave(master, slave, socket) {
        const body = '<zone master="{}"> {} </zone>';
        const member = `<member ipaddress="${slave.ip}">${slave.mac}</member>`;
        const str = string_format_1.default(body, master.mac, member);
        return socket._post("removeZoneSlave", str);
    }
    playSource(source, sourceAccount, contentItem) {
        let str;
        if (contentItem) {
            str = this.js2xml.buildObject(contentItem);
        }
        else {
            const body = '<ContentItem source="{}" sourceAccount="{}"></ContentItem>';
            str = string_format_1.default(body, source, sourceAccount);
        }
        return this._post("select", str);
    }
    async get(value) {
        const command = `http://${this.address}:8090/${value}`;
        this.adapter.log.debug("request: " + command);
        await axios_1.default({ method: "GET", url: command })
            .then(body => this._parse(body.data)).catch(error => this.adapter.log.error(error));
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
        ]);
    }
}
exports.soundtouchsocket = soundtouchsocket;
