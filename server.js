
const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 8;

const lobbies = new Map();

let nextLobbyId = 1;
let nextPlayerId = 1;

app.get("/", (_req, res) => {
	res.send("Multiplayer server is running!");
});

function sendTo(socket, data) {
	if (socket.readyState === WebSocket.OPEN) {
		socket.send(JSON.stringify(data));
	}
}

function broadcastLobbyList() {
	const lobbyList = [];

	for (const lobby of lobbies.values()) {
		lobbyList.push({
			id: lobby.id,
			name: lobby.name,
			map: lobby.map,
			players: lobby.players.size,
			max_players: lobby.max_players
		});
	}

	const message = {
		type: "lobby_list",
		lobbies: lobbyList
	};

	for (const client of wss.clients) {
		sendTo(client, message);
	}
}

function broadcastToGame(lobby, data, exceptSocket = null) {
	for (const player of lobby.gamePlayers.values()) {
		if (player.socket !== exceptSocket) {
			sendTo(player.socket, data);
		}
	}
}

function removeFromLobby(socket) {
	const lobbyId = socket.lobbyId;

	if (lobbyId === null || lobbyId === undefined) {
		return;
	}

	const lobby = lobbies.get(lobbyId);

	socket.lobbyId = null;
	socket.playerId = null;

	if (!lobby) {
		return;
	}

	const playerId = [...lobby.gamePlayers.entries()].find(
		([_id, player]) => player.socket === socket
	)?.[0];

	if (playerId !== undefined) {
		lobby.gamePlayers.delete(playerId);

		broadcastToGame(lobby, {
			type: "player_left",
			id: playerId
		});
	}

	lobby.players.delete(socket);

	if (lobby.players.size === 0) {
		lobbies.delete(lobbyId);
		console.log("Deleted empty lobby:", lobby.name);
	}

	broadcastLobbyList();
}

function makeLobbyInfo(lobby) {
	return {
		id: lobby.id,
		name: lobby.name,
		map: lobby.map,
		players: lobby.players.size,
		max_players: lobby.max_players
	};
}

wss.on("connection", (socket) => {
	console.log("Client connected");

	socket.lobbyId = null;
	socket.playerId = null;

	sendTo(socket, { type: "connected" });
	broadcastLobbyList();

	socket.on("message", (rawData) => {
		let message;

		try {
			message = JSON.parse(rawData.toString());
		} catch {
			return;
		}

		if (!message || typeof message.type !== "string") {
			return;
		}

		if (message.type === "create_lobby") {
			const map = String(message.map || "Forest");

			removeFromLobby(socket);

			const lobbyId = nextLobbyId++;
			const lobby = {
				id: lobbyId,
				name: "Room " + lobbyId,
				map,
				max_players: MAX_PLAYERS,
				players: new Map(),
				gamePlayers: new Map()
			};

			lobbies.set(lobbyId, lobby);
			lobby.players.set(socket, true);
			socket.lobbyId = lobbyId;

			sendTo(socket, {
				type: "lobby_created",
				lobby: makeLobbyInfo(lobby),
				host: true
			});

			broadcastLobbyList();
			console.log("Created:", lobby.name, "|", lobby.map);
			return;
		}

		if (message.type === "join_lobby") {
			const lobby = lobbies.get(Number(message.lobby_id));

			if (!lobby) {
				sendTo(socket, {
					type: "error",
					message: "Lobby does not exist."
				});
				return;
			}

			if (socket.lobbyId === lobby.id && lobby.players.has(socket)) {
				sendTo(socket, {
					type: "lobby_joined",
					lobby: makeLobbyInfo(lobby),
					host: false
				});
				return;
			}

			if (lobby.players.size >= lobby.max_players) {
				sendTo(socket, {
					type: "error",
					message: "Lobby is full."
				});
				return;
			}

			removeFromLobby(socket);

			lobby.players.set(socket, true);
			socket.lobbyId = lobby.id;

			sendTo(socket, {
				type: "lobby_joined",
				lobby: makeLobbyInfo(lobby),
				host: false
			});

			broadcastLobbyList();
			console.log("Lobby joined:", lobby.name);
			return;
		}

		if (message.type === "game_join") {
			const lobbyId = Number(message.lobby_id);
			const lobby = lobbies.get(lobbyId);

			if (!lobby || socket.lobbyId !== lobbyId || !lobby.players.has(socket)) {
				sendTo(socket, {
					type: "error",
					message: "Join the lobby before entering the game."
				});
				return;
			}

			let playerId = socket.playerId;

			if (!playerId || !lobby.gamePlayers.has(playerId)) {
				playerId = nextPlayerId++;
				socket.playerId = playerId;

				lobby.gamePlayers.set(playerId, {
					socket,
					x: 0,
					y: 0,
					animation: "idle_down"
				});

				broadcastToGame(lobby, {
					type: "player_joined",
					id: playerId,
					x: 0,
					y: 0,
					animation: "idle_down"
				}, socket);

				console.log("Player", playerId, "joined", lobby.name);
			}

			const existingPlayers = [];

			for (const [id, player] of lobby.gamePlayers) {
				if (id === playerId) {
					continue;
				}

				existingPlayers.push({
					id,
					x: player.x,
					y: player.y,
					animation: player.animation
				});
			}

			sendTo(socket, {
				type: "game_joined",
				player_id: playerId,
				map: lobby.map,
				players: existingPlayers
			});

			broadcastLobbyList();
			return;
		}

		if (message.type === "player_update") {
			const lobby = lobbies.get(socket.lobbyId);
			const playerId = socket.playerId;

			if (!lobby || !playerId) {
				return;
			}

			const player = lobby.gamePlayers.get(playerId);

			if (!player) {
				return;
			}

			const x = Number(message.x);
			const y = Number(message.y);

			if (!Number.isFinite(x) || !Number.isFinite(y)) {
				return;
			}

			player.x = x;
			player.y = y;
			player.animation = String(message.animation || "idle_down");

			broadcastToGame(lobby, {
				type: "player_update",
				id: playerId,
				x: player.x,
				y: player.y,
				animation: player.animation
			}, socket);
		}
	});

	socket.on("close", () => {
		console.log("Client disconnected");
		removeFromLobby(socket);
	});

	socket.on("error", (error) => {
		console.error("WebSocket error:", error.message);
	});
});

server.listen(PORT, "0.0.0.0", () => {
	console.log("Multiplayer server started on port", PORT);
});
