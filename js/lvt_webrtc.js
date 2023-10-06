/** @preserve Copyright (C) 2019 LiveView Technologies - All Rights Reserved **/
/**
 * File Name:  lvt_webrtc.js
 * Created By: Charles Hayward
 *
 * Javascript Class for playing webrtc video in an html5 video player
 */

window.RTCSessionDescription = window.RTCSessionDescription || window.mozRTCSessionDescription || window.webkitRTCSessionDescription;
window.RTCPeerConnection     = window.RTCPeerConnection     || window.mozRTCPeerConnection     || window.webkitRTCPeerConnection;
window.RTCIceCandidate       = window.RTCIceCandidate       || window.mozRTCIceCandidate       || window.webkitRTCIceCandidate;

const WEBRTC_STATES      = {STOPPED:0, CONNECTING:1, CONNECTED:2, BUFFERING:3, PLAYING:4, PAUSED:5, FAILED:6, DROPPED:7, INITIALIZING:8};
const WEBRTC_STATE_NAMES = ['stopped', 'connecting', 'connected', 'buffering', 'playing', 'paused', 'failed', 'dropped', 'initializing'];

/**
 * Currently supported parameters in optional settings argument are:
 *     autoPlay     - Indicates the video should play as soon as it is available (defaults to true)
 *     timeout      - Indicates how long to wait for an html element or video source before giving up (defaults to 600000 milliseconds)
 *     stepTimeout  - Indicates how long to spend on a step before giving up and retrying the step (defaults to 10000 milliseconds)
 *     fitContainer - Indicates if the player should scale to fit the player window (defaults to true)
 *     UDPOnly      - Use UDP playback only
 *     legacyMode   - Support legacy IE mode
 *     errorHandler - Callback that will be called with a JSON string of error data on failure
 *     stateHandler - Callback that will receive state changes (state: 0=Stopped, 1=Connecting, 2=Connected, 3=Buffering, 4=Playing, 5=Paused, 6=Failed, 7=Dropped)
 *     userData     - Custom application specific data to be sent to the streaming server with requests
 *     debug        - Indicates if debug data should be passed back to the hosting code (defaults to off)
 */

class WebRTCStreamer {

    constructor(element, host, appName, streamName, settings = {}) {
        host = host.split('/')[2] || host.split('/')[0]; // Extract the host from URL, if a deprecated URL was passed as the second parameter

        this._element              = element;
        this._websocketUrl         = 'wss://' + host + '/webrtc-session.json';
        this._peerConnectionConfig = {iceServers: []};
        this._streamInfo           = {applicationName: appName, streamName: streamName, sessionId: ''};
        this._settings             = settings;
        this._retryTime            = (settings.timeout !== undefined) ? settings.timeout : 60000;
        this._stepTimeout          = (settings.stepTimeout !== undefined) ? settings.stepTimeout : 10000;
        this._state                = WEBRTC_STATES.STOPPED;
        this._UDPOnly              = (settings.UDPOnly !== undefined) ? settings.UDPOnly : false;
        this._legacyMode           = (settings.legacyMode !== undefined) ? settings.legacyMode : false;

        if (this._settings.autoPlay !== false) // Note: undefined should be considered true (the default)
            this.play(settings.timeout, false); // If a play timeout was provided, start playback now, otherwise wait for the play method to be called

        // make sure the step timeout isn't larger than the overall timeout
        if (this._retryTime < this._stepTimeout)
            this._retryTime = this._stepTimeout *2;

        this._debug("retryTime: " + this._retryTime + " stepTimeout: " + this._stepTimeout);
    }

    play(timeout = null, forcePlay = true) {
        this._debug('play()');
        if ((this._state != WEBRTC_STATES.STOPPED) && (this._state != WEBRTC_STATES.FAILED)) {
            this._debug('play() redundant play request ignored.  Current: ' + this._state);
            return;
        }

        this._stateHandler(WEBRTC_STATES.INITIALIZING);

        this._forcePlay = forcePlay;
        if (timeout)
            this._settings.timeout = timeout;

        if (!this._peerConnection) {
            this._resetTimeout();
            this._startWebrtc();
        }
    }

    stop() {
        this._debug('stop()');
        this._stopWebrtc();
    }

    destroy() {
        this._debug('destroy()');
        this._stopWebrtc();
        this._settings = {}
        this._streamInfo = {}
        this._container = null
        this._element = null
    }

    _getMilliseconds() {
        if (performance && performance.now)
            return performance.now();
        else
            return new Date().getTime();
    }

    _resetTimeout() {
        this._retryUntil = this._getMilliseconds() + this._retryTime;
    }

    _playTimedOut() {
        return this._getMilliseconds() > this._retryUntil;
    }

    _startWebrtc() {
        if (typeof this._element == 'string') {
            this._container = document.getElementById(this._element);

            if (!this._container) {
                if (this._playTimedOut()) {
                    this._debug('startWebtrc() video element not found');
                    this._stateHandler(WEBRTC_STATES.FAILED);
                }
                else
                    setTimeout(this._startWebrtc.bind(this), 250); // Try again in 250ms
            }
        }
        else
            this._container = this._element;

        if (this._container) {
            if (this._container.nodeName == 'VIDEO')
                this._videoPlayer = this._container;
            else {
                var list = this._container.getElementsByTagName('VIDEO');
                if (list.length > 0)
                    this._videoPlayer = list[0];
                else {
                    this._videoPlayer = document.createElement('VIDEO');
                    if (this._forcePlay || this._settings.autoPlay !== false)
                        this._videoPlayer.autoplay=true;
                    this._videoPlayer.muted=true;
                    this._videoPlayer.playsinline=true;
                    if (this._settings.fitContainer !== false) // Note: undefined should be considered true (the default)
                        this._videoPlayer.style='width:100%; Height:100%;';
                    this._videoPlayer.src = '';
                    this._videoPlayer = this._container.appendChild(this._videoPlayer);
                }
            }

            if (this._videoPlayer) {
                this._videoPlayer.onwaiting   = this._playerStateChanged.bind(this);
                this._videoPlayer.onplay      = this._playerStateChanged.bind(this);
                this._videoPlayer.onpause     = this._playerStateChanged.bind(this);
            }

            if ( this._videoPlayer && !this._peerConnection && // If we have a player and are not already playing
                (this._forcePlay || this._videoPlayer.hasAttribute('autoplay')) ) {
                if (this._forcePlay)
                    this._videoPlayer.setAttribute('autoplay', '');
                this._webrtcConnect();
            }
        }
    }

    _stopWebrtc() {
        this._debug('stopWebrtc()');
        this._disconnect();
        if (this._state != WEBRTC_STATES.FAILED)  // don't override the bad state, but do cleanup
            this._stateHandler(WEBRTC_STATES.STOPPED);

        if (this._videoPlayer) {
            this._videoPlayer.src = '';
            this._videoPlayer.pause();
        }
        this._videoPlayer = null;
    }

    _restartWebrtc(mode) {
        this._debug('retstartWebrtc(mode' + mode + ')');
        switch(mode) {
            case 0: // Reassign (Fast: A fraction of a second)
                try {
                    var stream = this._videoPlayer.srcObject;
                    this._videoPlayer.srcObject = undefined;
                    this._videoPlayer.srcObject = stream;
                } catch (error) {
                    var stream = this._videoPlayer.src;
                    this._videoPlayer.src = undefined;
                    this._videoPlayer.src = stream;
                }
                return;
            case 1:  // Reconnect (Slow: At least 1 second)
                this._onWebrtcOpen();
                return;
            case 2: // Renegotiate (Slowest: May take a few seconds)
                this._disconnect();
                this._webrtcConnect();
        }
    }

    _formatDate(dt) {
        var d = !dt ? new Date() : dt;
        var yyyy = (d.getFullYear()).toString().padStart(4, '0');
        var mm   = (d.getMonth() + 1).toString().padStart(2, '0');
        var dd   = (d.getDate()).toString().padStart(2, '0');
        var hh   = (d.getHours()).toString().padStart(2, '0');
        var mn   = (d.getMinutes()).toString().padStart(2, '0');
        var ss   = (d.getSeconds()).toString().padStart(2, '0');
        var mss  = (d.getMilliseconds()).toString().padStart(3, '0');
        return yyyy + '-' + mm + '-' + dd + ' ' + hh + ':' + mn + ':' + ss + '.' + mss;
    }

    _stateHandler(state) {
        if (state != this._state && this._container) {
            this._debug("stateHandler() state change: '" + WEBRTC_STATE_NAMES[this._state] + "' => '" + WEBRTC_STATE_NAMES[state] + "'");
            this._state = state;
            if (this._settings.stateHandler) {
                var date = this._formatDate();
                this._settings.stateHandler( {playerId:this._container.id, state:state, stateName:WEBRTC_STATE_NAMES[state], date:date} );
            }
        }
    }

    _debug(data) {
        if (this._settings.debug && this._container)
            this._settings.debug(this._formatDate().toString() + ' WebRTCStreamer.' + data);
    }

    _errorHandler(status, data) {
        if (this._container && this._settings.errorHandler)
            this._settings.errorHandler( {data:data, date:this._formatDate(), playerId:this._container.id, status:status} );
    }

    _onWebrtcError(event) {
        this._debug('onWebrtcError() reconnecting, event: ' + JSON.stringify(event));
        this._restartWebrtc(1);
    }

    _socketSend(data) {
        if (this._wsConnection) {
            if (this._wsConnection.readyState == WebSocket.OPEN)
                this._wsConnection.send(data);
            else
                this._errorHandler(503, 'websocket not ready (state:' + this._wsConnection.readyState + ')');  // 503 is a bad gateway.. we can't open the socket, so buh bye
        }
    }

    _requestOffer() {
        this._debug('requestOffer()');
        this._socketSend(JSON.stringify({direction:'play', command:'getOffer', streamInfo:this._streamInfo, userData:((!this._settings.userData) ? '' : this._settings.userData)}));
    }

    _sendResponse(description) {
        this._debug('sendResponse() description ' + JSON.stringify(description));
        this._peerConnection.setLocalDescription(description).then(
            function() {
                this._socketSend(JSON.stringify({direction:'play', command:'sendResponse', streamInfo:this._streamInfo, sdp:this._peerConnection.localDescription, userData:((!this._settings.userData) ? '' : this._settings.userData)}));
            }.bind(this)
        );
    }

    _receieveRemoteStream(event) {
        this._debug('receiveRemoteStream() event: ' + JSON.stringify(event));
        var stream = (event.streams) ? event.streams[0] : event.stream;
        this._stateHandler(WEBRTC_STATES.BUFFERING);
        try {
            this._videoPlayer.srcObject = stream;
        } catch (error) {
            this._videoPlayer.src = window.URL.createObjectURL(stream);
        }
        this._streamAuditSet(this._stepTimeout);
    }

    _playerStateChanged(event) {
        if (event && event.type) {
            this._debug('playerStateChanged() event.type: ' + event.type);
            switch(event.type) {
                case 'waiting':
                    this._stateHandler.apply(this, [WEBRTC_STATES.BUFFERING]);
                    return;
                case 'play':
                    this._stateHandler.apply(this, [WEBRTC_STATES.PLAYING])
                    this._streamAuditSet(1000);
                    return;
                case 'pause':
                    this._stateHandler.apply(this, [WEBRTC_STATES.PAUSED])
                    return;
            }
        }
    }

    _peerConnectionStateChanged(event) {
        this._debug('peerConnectionStateChanged() event.type: ' + event.type);
        var newConnState = this._peerConnection.connectionState;
        this._connectionStateChanged(newConnState);
    }

    _iceConnectionStateChanged(event) {
        this._debug('iceConnectionStateChanged() event.type: ' + event.type);
        var newConnState = this._peerConnection.iceConnectionState;
        this._connectionStateChanged(newConnState);
    }

    _connectionStateChanged(newConnState) {
        if (this._peerConnection) {
            this._debug('peerConnectionStateChanged() legacyMode: ' + this._legacyMode + ' newConnState: ' + newConnState);

            switch(newConnState) {
                case 'new':
                case 'checking':
                case 'connecting':
                case 'connected':
                case 'completed':
                    if (this._videoPlayer.currentTime > 0) // If some frames have already been played
                        this._stateHandler.apply(this, [WEBRTC_STATES.PLAYING]) // We are actually "resuming" playback after a reconnect
                    else
                        this._streamAuditSet(this._stepTimeout); // Reset stream audit since we are getting closer to playback
                    return;
                case 'disconnected':
                case 'closed':
                case 'failed':
                    var disconnected = (this._state == WEBRTC_STATES.PLAYING && newConnState == 'disconnected');
                    if (disconnected || !this._playTimedOut()) {
                        this._debug('connectionStateChange(' + newConnState + 'connection lost (temporarily)');
                        if (disconnected)
                            this._restartWebrtc(1);
                        return;
                    }

                    this._stateHandler(WEBRTC_STATES.DROPPED);
                    this._debug('connectionStateChanged(' + newConnState + ') connection lost (permanently)');
                    this.stop();
                    return;
            }
        }
    }

    _streamAuditCheck() {
        var streamTime = this._videoPlayer.currentTime;
        var streamConnected = this._state > WEBRTC_STATES.CONNECTING && this._state < WEBRTC_STATES.PAUSED;
        var streamStarted = streamTime || this._state == WEBRTC_STATES.PLAYING;
        var streamProgress = streamTime && streamTime != this._lastTime;
        this._lastTime = streamTime;

        if (this._state == WEBRTC_STATES.PLAYING && streamProgress) {
            this._debug('streamAuditCheck() success ' + streamTime);
            if (this._auditPeriod > 1000)
                this._streamAuditSet(1000);
        }
        else if ( (!streamStarted && this._playTimedOut()) || (this._auditPeriod > this._stepTimeout) ) {
            this._debug('streamAuditCheck() failure');
            this._stateHandler(WEBRTC_STATES.FAILED);
            this._streamAuditSet(-1);
        }
        else if (streamConnected && !streamProgress) {
            this._debug('streamAuditCheck() restarting stream');
            this._restartWebrtc(this._auditPeriod < 5000 ? 0 : 2);
            this._streamAuditSet(this._auditPeriod * 1.5);
        }
    }

    // Schedule a new player audit interval if period > 0.  Terminate any existing player audit if period < 0.
    _streamAuditSet(period) {
        this._debug('streamAuditSet(' + period +') state: ' + this._state );
        this._auditPeriod = (this._state > WEBRTC_STATES.STOPPED && this._state < WEBRTC_STATES.PAUSED) ? period : -1;
        // We should remove any existing _startTimer if the audit is complete, or if we are going to start it again
        if (this._auditPeriod && this._startTimer) {
            clearInterval(this._startTimer);
            this._startTimer = null;
        }

        if (this._auditPeriod > 0) {
            this._debug('streamAuditSet() auditPeriod: ' + this._formatDate(new Date(Date.now() + this._auditPeriod)));
            this._startTimer = setInterval(this._streamAuditCheck.bind(this), this._auditPeriod);
        }
    }

    _onWebrtcOpen(event) {
        this._debug('onWebrtcOpen() event: ' + event);
        var oldPeerConnection = this._peerConnection;

        this._stateHandler(WEBRTC_STATES.CONNECTED);
        this._peerConnection = new RTCPeerConnection(this._peerConnectionConfig);
        this._peerConnection.ontrack = this._receieveRemoteStream.bind(this);

        // The FireFox player continues to report a play time delta during the stream audit test even when the stream has disconnected on
        // the camera relay.  However, the ice connection callback is called on firefox when this happens (and used to get ignored), so
        // I've added the test for UDPOnly since firefox only supports UDP and hence the only time that is set right now.
        // IE8 - ice connection monitoring only
        // FireFox - ice and peer connection monitoring only
        // Chrome/Safari - peer connection monitoring only
        // if (this._legacyMode || this._UDPOnly)
        this._peerConnection.oniceconnectionstatechange = this._iceConnectionStateChanged.bind(this); // IE only supports this, FF supports both

        if (!this._legacyMode)
            this._peerConnection.onconnectionstatechange = this._peerConnectionStateChanged.bind(this); // For other browsers, this is better

        this._requestOffer();

        this._streamAuditSet(this._stepTimeout);

        if (oldPeerConnection) { // It takes time to close.  So close the oldPeerConnection after requesting a new one (if any existed)
            oldPeerConnection.onconnectionstatechange = oldPeerConnection.oniceconnectionstatechange = null;
            oldPeerConnection.close();
        }
    }

    _onWebrtcClose(event) {
        this._debug('onWebrtcClose() event: ' + JSON.stringify(event.data));
        this.stop();
    }

    _onWebrtcMessage(event) {
        var msgJSON = JSON.parse(event.data);
        var msgStatus = Number(msgJSON.status);
        var msgCommand = msgJSON.command;
        var streamInfo = msgJSON.streamInfo;
        var iceCandidates = msgJSON.iceCandidates;
        var sdp = msgJSON.sdp;

        this._debug('onWebrtcMessage() event:\n ' + JSON.stringify(msgJSON, null, 2));

        if (msgStatus == 200) {
            if (streamInfo)
                this._streamInfo.sessionId = streamInfo.sessionId;

            if (sdp) {
                this._peerConnection.setRemoteDescription(new RTCSessionDescription(sdp)).then(
                    function() {
                        // Only create answers in response to offers
                        if (sdp.type == 'offer')
                            this._peerConnection.createAnswer().then(this._sendResponse.bind(this));
                    }.bind(this)
                );
            }

            if (iceCandidates) {
                for (var c of iceCandidates) {
                    if (this._UDPOnly || c.candidate.indexOf(' TCP ') >= 0) { // Only accept UDP candidates on Firefox browsers which don't support TCP
                        this._peerConnection.addIceCandidate(new RTCIceCandidate(c));
                        this._debug('onWebrtcMessage() adding ice candidate: ' + c.candidate);
                    }
                }
            }
        }
        // 502 is the stream is still connecting on the camera relay, 504 the stream hasn't been started on the camera relay
        else if (Math.floor(msgStatus / 100) == 5 && !this._playTimedOut() && msgCommand !== 'sendResponse' && msgCommand !== 'getAvailableStreams') {
            this._errorHandler(msgStatus, 'onWebrtcMessage() stream not ready (waiting) msgCommand: ' + msgCommand);
            setTimeout(this._requestOffer.bind(this), 250);
        }
        else {
            this._debug('onWebrtcMessage() stream not ready (aborting)');
            this._stateHandler(WEBRTC_STATES.FAILED);
            this.stop();
        }
    }

    _webrtcConnect() {
        this._debug("webrtcConnect()");
        this._stateHandler(WEBRTC_STATES.CONNECTING);

        this._wsConnection            = new WebSocket(this._websocketUrl);
        this._wsConnection.binaryType = 'arraybuffer';
        this._wsConnection.onopen     = this._onWebrtcOpen.bind(this);
        this._wsConnection.onmessage  = this._onWebrtcMessage.bind(this);
        this._wsConnection.onclose    = this._onWebrtcClose.bind(this);
        this._wsConnection.onerror    = this._onWebrtcError.bind(this);
    }

    _disconnect() {
        this._debug('disconnect()');
        this._streamAuditSet(-1);

        if (this._wsConnection) {
            this._wsConnection.onopen    = null;
            this._wsConnection.onmessage = null;
            this._wsConnection.onclose   = null;
            this._wsConnection.onerror   = null;
            if (this._peerConnection)
                this._peerConnection.close();
            this._peerConnection = null;
            this._wsConnection.close();
            this._wsConnection = null;
        }
    }
}
