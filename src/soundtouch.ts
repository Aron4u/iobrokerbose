import { EventEmitter } from 'events';
import { Bosesoundtouchadapter } from './main';
import * as xml2js from 'xml2js';
import { Builder } from 'xml2js';
import WebSocket from 'ws';
import { stringify } from 'querystring';
import axios, { AxiosRequestConfig } from 'axios'

var format = require('string-format');

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
    private _lastMessage: number = 0;

    constructor(adapter: Bosesoundtouchadapter) {
        super();
        this.address = (adapter.config as any).address;
        if (!this.address) {
            throw new Error('soundtouchsocket needs an address');
        }
        var address = 'ws://' + this.address + ':8080/';
        this.ws = new WebSocket(address, 'gabbo');

        this.adapter = adapter;
        // this.request = require('request');
        // this.promise = require('es6-promise');
        // this.xml2js = require('xml2js');
        this.js2xml = new xml2js.Builder({ headless: true, rootName: 'ContentItem', renderOpts: { pretty: false } });
    }

    connect() {
        this.adapter.log.debug('connect');

        return new Promise((resolve, reject) => {
            this.adapter.log.info('connecting to host ' + this.ws.url);

            this.ws.on('open', () => this._onOpen(resolve));
            this.ws.on('close', () => this._onClose());
            this.ws.on('error', (error) => { this._onError(error, reject); });
            this.ws.on('message', (data: any, flags: any) => { this._onMessage(data, flags); });

        });
    }

    _heartBeatFunc() {
        this.adapter.log.debug('_heartBeatFunc');
        if (Date.now() - this._lastMessage > 30000) {
            this.adapter.log.warn('heartbeat timeout');
            this.ws.close();
            this.clearHearthBeat();
        }
        else {
            //this.adapter.log.debug('<span style="color:darkblue;">sending heartbeat');
            this.send('webserver/pingRequest');
        }
    }

    _restartHeartBeat() {
        this.adapter.log.debug('_restartHeartBeat');
        this._lastMessage = Date.now();

        this.clearHearthBeat();
        this.heartBeatInterval = setInterval(() => { this._heartBeatFunc(); }, 10000);
    }

    clearHearthBeat() {
        if (this.heartBeatInterval) {
            clearInterval(this.heartBeatInterval);
        }
    }

    _onOpen(resolve: Function) {
        this.adapter.log.debug('onOpen');
        this._restartHeartBeat();
        this.emit('connected');
        resolve();
    }

    _onClose() {
        this.adapter.log.debug('onClose');
        this.clearHearthBeat()
        this.emit('closed');
    }

    _onError(error: Error, reject: Function) {
        this.adapter.log.error('websocket error ' + error);
        this.emit('error', error);
        reject();
    }

    _onMessage(data: string, flags: any) {
        this.adapter.log.debug('onMessage' + flags);
        this._parse(data);
    }

    send(data: any) {
        return new Promise<void>((resolve, reject) => {
            this.adapter.log.debug('Send: ' + data);
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
        this.adapter.log.debug('received [volume]:' + volume.actualvolume);
        var obj = {
            volume: volume.actualvolume,
            muted: volume.muteenabled == 'true'
        };
        this.emit('volume', obj);
    }

    _handlePresets(data: any) {
        var object: { source: string, name: string, iconUrl: string }[] = [];
        for (var i = 0; i < 6; i++) {
            object[i] = {
                source: '',
                name: '',
                iconUrl: ''
            };
        }
        if (data.presets) {
            this.adapter.log.debug('received [presets]:' + JSON.stringify(data.presets));
            if (data.presets.preset) {
                var presets = data.presets.preset;
                var contentItem;
                var id;
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
        this.emit('presets', object);
    }

    _handleSources(data: any) {
        this.adapter.log.debug('received [sources]:' + JSON.stringify(data.sourceItem));
        var object = [];
        for (var i in data.sourceItem) {
            var source = data.sourceItem[i].$;
            object.push({
                name: source.source,
                sourceAccount: source.sourceAccount,
                isLocal: source.isLocal == 'true',
                multiRoomAllowed: source.multiroomallowed,
                status: source.status
            });
        }
        this.emit('sources', object);
    }

    _handleDeviceInfo(data: any) {
        this.adapter.log.debug('received [info] ' + JSON.stringify(data));
        var networkInfo;
        if (Array.isArray(data.networkInfo)) {
            networkInfo = data.networkInfo[0];
        }
        else {
            networkInfo = data.networkInfo;
        }
        var object = {
            name: data.name,
            type: data.type,
            macAddress: data.$.deviceID,
            ipAddress: networkInfo.ipAddress
        };
        this.emit('deviceInfo', object);
    }

    _handleNowPlaying(data: any) {
        this.adapter.log.debug('received [now_playing] ' + JSON.stringify(data));
        var object = {
            source: data.$.source,
            track: '',
            artist: '',
            album: '',
            station: '',
            art: '',
            genre: '',
            time: '',
            total: '',
            playStatus: '',
            repeatStatus: '',
            shuffleStatus: '',
            contentItem: null,
            repeatSetting: '',
            shuffleSetting: '',
        };
        switch (data.$.source) {
            case 'AMAZON':
            case 'BLUETOOTH':
            case 'INTERNET_RADIO':
            case 'SPOTIFY':
            case 'DEEZER':
            case 'STORED_MUSIC':
            case 'TUNEIN':
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

            case 'PRODUCT':
                object.station = data.$.sourceAccount;
                break;
        }

        this.emit('nowPlaying', object);
    }

    _handleZone(data: any) {
        this.emit('zones', data);
    }

    _onJsData(jsData: any) {
        this.adapter.log.debug(JSON.stringify(jsData));
        for (let infoItem in jsData) {
            switch (infoItem) {
                case 'info':
                    this._handleDeviceInfo(jsData[infoItem]);
                    break;

                case 'nowPlaying':
                    this._handleNowPlaying(jsData[infoItem]);
                    break;

                case 'bass':
                    this._handleBassInfo(jsData[infoItem]);
                    break;

                case 'bassCapabilities':
                    this._handleBassCaps(jsData[infoItem]);
                    break;

                case 'volume': {
                    var volume = jsData.volume;
                    if (volume) {
                        this._handleVolume(volume);
                    }
                    break;
                }

                case 'presets':
                    this._handlePresets(jsData);
                    break;

                case 'sources':
                    this._handleSources(jsData[infoItem]);
                    break;

                case 'zone':
                    this._handleZone(jsData[infoItem]);
                    break;

                case 'trackInfo':
                    this._handleTrackInfo(jsData[infoItem]);
                    break;

                case 'updates':
                    if (jsData.hasOwnProperty('updates')) {
                        for (var updateItem in jsData.updates) {
                            switch (updateItem) {
                                case 'nowPlayingUpdated': {
                                    var nowPlaying = jsData.updates.nowPlayingUpdated.nowPlaying;
                                    if (nowPlaying) {
                                        this._handleNowPlaying(nowPlaying);
                                    }
                                    else {
                                        this.getInfo();
                                    }
                                    break;
                                }

                                case 'volumeUpdated': {
                                    var vol = jsData.updates.volumeUpdated.volume;
                                    if (vol) {
                                        this._handleVolume(vol);
                                    }
                                    else {
                                        this.getVolume();
                                    }
                                    break;
                                }

                                case 'zoneUpdated': {
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
        throw new Error('Method not implemented.');
    }
    private _handleTrackInfo(arg0: any) {
        throw new Error('Method not implemented.');
    }
    private _handleBassCaps(arg0: any) {
        throw new Error('Method not implemented.');
    }
    private _handleBassInfo(arg0: any) {
        throw new Error('Method not implemented.');
    }

    _parse(xml: string) {
        var instance = this;
        xml2js.parseString(xml, { explicitArray: false }, function (err, jsData) {
            if (err) {
                instance.adapter.log.error(JSON.stringify(err));
            }
            else {
                instance._onJsData(jsData);
            }
        });
    }

    async _post(command: string, bodyString: string) {
        var options: AxiosRequestConfig = {
            method: "post",
            url: `http://${this.address}:8090/${command}`,
            data: bodyString
        };
        this.adapter.log.debug(`_post: ${options.url}, ${options.data}`);
        await axios(options)
            .then(() => {

            }).catch((error) => {
                if (typeof error === 'string') {
                    this.adapter.log.error(error);
                } else {
                    this.adapter.log.error(JSON.stringify(error));
                }

            });
    }

    setValue(command: string, args: string, value: string) {
        if (args !== '' && args[0] != ' ') {
            args = ' ' + args;
        }
        var bodyString = '<' + command + args + '>' + value + '</' + command + '>';
        this._post(command, bodyString);
    }

    createZone(master: IDevice, slaves: IDevice[]) {
        const body = '<zone master="{}"> {} </zone>';
        const member = '<member ipaddress="{}">{}</member>';

        var members = '';
        slaves.forEach(slave => {
            members = members + format(member, slave.ip, slave.mac);
        });
        var str = format(body, master.mac, members);
        this._post('setZone', str);
    }

    addZoneSlave(master: IDevice, slave: IDevice, socket: soundtouchsocket) {
        const body = '<zone master="{}"> {} </zone>';
        const member = `<member ipaddress="${slave.ip}">${slave.mac}</member>`;
        var str = format(body, master.mac, member);
        return socket._post('addZoneSlave', str);
    }

    removeZoneSlave(master: IDevice, slave: IDevice, socket: soundtouchsocket) {
        const body = '<zone master="{}"> {} </zone>';
        const member = `<member ipaddress="${slave.ip}">${slave.mac}</member>`;
        var str = format(body, master.mac, member);
        return socket._post('removeZoneSlave', str);
    }

    playSource(source: string, sourceAccount: string, contentItem: string) {
        var str;
        if (contentItem) {
            str = this.js2xml.buildObject(contentItem);
        }
        else {
            const body = '<ContentItem source="{}" sourceAccount="{}"></ContentItem>';
            str = format(body, source, sourceAccount);
        }
        return this._post('select', str);
    }

    async get(value: string) {
        var instance = this;
        var command = `http://${this.address}:8090/${value}`;
        this.adapter.log.debug('request: ' + command);

        await axios({ method: 'GET', url: command })
            .then(body => this._parse(body.data)
            ).catch(error => this.adapter.log.error(error));
    }

    getDeviceInfo() {
        this.get('info');
    }

    getPlayInfo() {
        this.get('now_playing');
    }

    getPresets() {
        this.get('presets');
    }

    getVolume() {
        this.get('volume');
    }

    getSources() {
        this.get('sources');
    }

    getZone() {
        this.get('getZone');
    }

    updateAll() {
        this.adapter.log.debug('updateAll');
        var instance = this;
        return Promise.all([
            instance.getDeviceInfo(),
            instance.getPlayInfo(),
            instance.getPresets(),
            //_instance.getBassCapabilities(),
            //_instance.getBassInfo(),
            instance.getVolume(),
            instance.getSources(),
            instance.getZone(),
            //_instance.getTrackInfo()
        ]);
    }

};
