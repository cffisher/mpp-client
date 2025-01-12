/* "Multiplayer Piano Node.js Client" v1.0.0
mppClient.js
2025.01.11 - 2025.01.12

This is a barebones Node.js WebSocket client created for Multiplayer Piano.
Based on: https://github.com/mppnet/frontend

Callum Fisher <cf.fisher.bham@gmail.com> */

// Fetch dependencies:

webSocket = require('ws');
eventEmitter = require('events').EventEmitter;

// Define and export the pianoClient class as an extension of eventEmitter:

module.exports = class pianoClient extends eventEmitter {

	// Define a constructor for 'pianoClient':

	constructor (settings) {

		super();

		this.connect = this.connect.bind(this);
		this.disconnect = this.disconnect.bind(this);

		// Define settings for this client:

		if (typeof settings !== 'object' || !config.address) return;

		this.address = config.address;
		
		if (config.desiredChannel) this.desiredChannel = config.desiredChannel;
		if (config.pingTime) this.pingTime = config.pingTime;

		this.serverTimeOffset = 0;
		this.users = {};
		// this.noteBuffer = [];
		// this.noteBufferTime = 0;
		this['🐈'] = 0;

		this.offlineUser = {
			name: '',
			_id: '',
			color: '#000000'
		}

	}

	// Define functions:

	connect () {

		// Are we already connected or connecting?

		if (this.connected() || this.connecting()) return; // Yes, do not connect again.

		// No, create a new WebSocket at the provided address:

		this.ws = new webSocket(this.address); /* {
			origin: 'https://game.multiplayerpiano.com'
		}); */

		// Listen for opening of WebSocket connection:

		this.ws.addEventListener('open', () => {

			// Prepare our 'hi' message:

			let toSend = [{
				'm': 'hi',
				'x': 50,
				'y': 50,
				'🐈': this['🐈']++ || undefined // I don't why this cat is here, but it's here.
			}];

			// If this server uses tokens, check if a token was specified:

			if (this.config.token) toSend.token = this.config.token;

			// Send our 'hi' message:

			this.send(toSend);

			// Remove the token:

			delete this.config.token; // this.config.token = '[Redacted]';

			// Create an interval for sending ping messages:

			this.pingInterval = setInterval(() => { // Ping ('t') at least every 60 seconds:
				this.send([{
					m: 't',
					e: Date.now()
				}]);
			}, this.pingTime || 20000); // Use specified pingTime or 20 second default
		
			this.emit('connect');

		});

		// Listen for closing of WebSocket connection:

		this.ws.addEventListener('close', event => {
			
			// Delete this user information:

			delete this.user;
			delete this.userId;
			delete this.channel;

			clearInterval(this.pingInterval);
			clearInterval(this.noteBufferInterval);

			this.setUsers([]); // So no users are found

			this.emit('disconnect', event);

		});

		this.ws.addEventListener('error', error => {

			this.emit('webSocketError', error);

			this.ws.close();

		});

		// Listen for WebSocket messages:

		this.ws.addEventListener('message', message => {

			message = JSON.parse(message.data);
	
			for (let i = 0; i < message.length; i++) {

				let msg = message[i];

				this.emit(msg.m, msg); // Re-emit the message locally

			} // E.G. { m: 'type (a)', msg: { a: 'message', p: { participant info } } }

		});

		// Define event listeners:

		// Listen for 'hi' on connect:

		this.on('hi', msg => {

			this.user = msg.u;
			this.setServerTime(msg.t, msg.e || undefined);
			this.setChannel();

		});

		// Listen for 't' reponse to 't' pings:

		this.on('t', msg => { // msg.t - time server received client ping, msg.e - time client sent ping (optional)
			this.setServerTime(msg.t, msg.e || undefined);
		});

		// Listen for 'ch' for channel updates: (settings, new channel)

		this.on('ch', msg => {

			if (!this.desiredChannel) this.desiredChannel = msg.ch._id;

			this.desiredChannelSettings = msg.ch.settings;
			this.channel = msg.ch;

			if (msg.p) this.userId = msg.p;

			this.setUsers(msg.ppl);
			
		});

		this.on('p', msg => {
			this.updateUsers(msg);
			this.emit('userUpdate', this.findUserById(msg.id));
		});

		this.on('m', msg => {
			if (this.users.hasOwnProperty(msg.id)) this.updateUsers(msg);
		});

		this.on('bye', msg => {
			this.removeUser(msg.p);
		});

	}

	disconnect() {
		if (this.ws) this.ws.close();
	}

	connected () {
		return this.ws && this.ws.readyState === WebSocket.OPEN;
	}

	connecting () {
		return this.ws && this.ws.readyState === WebSocket.CONNECTING;
	}

	send (input) {
		if (this.connected()) this.ws.send((JSON.stringify(input)));
	}

	sendChat (input) {
		this.send([{
			'm': 'a',
			'message': input
		}]);
	}

	setChannel (channel, settings) {

		this.desiredChannel = channel || this.desiredChannel || this.config.desiredChannel || 'lobby'; // Default
		this.desiredChannelSettings = settings || this.desiredChannelSettings || undefined;

		if (!this.connected()) return;

		this.send([{
			m: 'ch',
			_id: this.desiredChannel,
			set: this.desiredChannelSettings
		}]);

	}

	// Define user management functions:

	countUsers () {

		let count = 0;

		for (let i in this.users) if (this.users.hasOwnProperty(i)) count ++;

		return count;
	}

	updateUsers (update) {

		let user = this.users[update.id] || undefined;

		if (typeof user !== 'undefined') {

			user = update;

			this.users[user.id] = user;

			this.emit('userJoin', user);
			this.emit('userCount', this.countUsers());

		} else {

			if (update.x) user.x = user.x;
			if (update.y) user.y = user.y;
			if (update.color) user.color = update.color;
			if (update.name) user.name = user.name;
			
		}

	}

	setUsers (ppl) {

		// Remove users who have left:

		for (let id in this.users) {

			if (!this.users.hasOwnProperty(id)) continue;

			let found = false;

			for (let j = 0; j < ppl.length; j++) {
				if (ppl[j].id === id) {
					found = true;
					break;
				}
			}

			if (!found) this.removeUser(id);

		}

		// Update users:

		for (let i = 0; i < ppl.length; i++) this.updateUsers(ppl[i]);

	}

	removeUser (id) {

		if (!this.users.hasOwnProperty(id)) return;

		let user = this.users[id];
		delete this.users[id];

		this.emit('userLeave', user);
		this.emit('userCount', this.countUsers());

	}

	getOwnUser () {
		return this.findUserById(this.userId);
	}

	findUserById (id) {
		return this.users[id] || this.offlineUser;
	}

	setName (name) {
		this.send([{
			'm': 'userset',
			'set': {
				'name': name
			}
		}]);
	}

	setServerTime (time) {

		let now = Date.now();
		let target = time - now;
		let duration = 1000;

		let step = 0;
		let steps = 50;
		let stepMS = duration / steps;

		let difference = target - this.serverTimeOffset;
		let inc = difference / steps;

		let interval = setInterval(() => {

			this.serverTimeOffset += inc;

			step ++;

			if (step >= steps) {

				clearInterval(interval);

				this.serverTimeOffset = target;

			}

		}, stepMS);

	}

}