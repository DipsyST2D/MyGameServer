const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

const lobbies = new Map();

let nextLobbyId = 1;
let nextPlayerId = 1;

app.get("/", (req, res) => {
    res.send("Multiplayer server is running!");
});

function sendTo(socket, data) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
    }
}

function broadcastLobbyList() {
    const lobbiesArray = [];

    for (const lobby of lobbies.values()) {
        lobbiesArray.push({
            id: lobby.id,
            name: lobby.name,
            map: lobby.map,
            players: lobby.players.size,
            max_players: lobby.max_players
        });
    }

    const message = {
        type: "lobby_list",
        lobbies: lobbiesArray
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

wss.on("connection", (socket) => {
    console.log("Client connected");

    socket.lobbyId = null;
    socket.playerId = null;

    sendTo(socket, {
        type: "connected"
    });

    broadcastLobbyList();

    socket.on("message", (data) => {
        let message;

        try {
            message = JSON.parse(data.toString());
        } catch {
            console.log("Invalid JSON received");
            return;
        }

        if (message.type === "create_lobby") {
            const lobbyId = nextLobbyId++;

            const lobby = {
                id: lobbyId,
                name: "Room " + lobbyId,
                map: String(message.map),
                max_players: 8,
                players: new Map(),
                gamePlayers: new Map()
            };

            lobbies.set(lobbyId, lobby);

            socket.lobbyId = lobbyId;

            lobby.players.set(socket, true);

            console.log(
                "Created:",
                lobby.name,
                "|",
                lobby.map
            );

            sendTo(socket, {
                type: "lobby_created",
                lobby: {
                    id: lobby.id,
                    name: lobby.name,
                    map: lobby.map,
                    players: 1,
                    max_players: lobby.max_players
                },
                host: true
            });

            broadcastLobbyList();
        }

        else if (message.type === "join_lobby") {
            const lobbyId = Number(message.lobby_id);
            const lobby = lobbies.get(lobbyId);

            if (!lobby) {
                sendTo(socket, {
                    type: "error",
                    message: "Lobby does not exist."
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

            socket.lobbyId = lobbyId;

            lobby.players.set(socket, true);

            console.log(
                "Lobby joined:",
                lobby.name
            );

            sendTo(socket, {
                type: "lobby_joined",
                lobby: {
                    id: lobby.id,
                    name: lobby.name,
                    map: lobby.map,
                    players: lobby.players.size,
                    max_players: lobby.max_players
                },
                host: false
            });

            broadcastLobbyList();
        }

        else if (message.type === "game_join") {
            const lobbyId = Number(message.lobby_id);
            const lobby = lobbies.get(lobbyId);

            if (!lobby) {
                sendTo(socket, {
                    type: "error",
                    message: "Lobby does not exist."
                });
                return;
            }

            const playerId = nextPlayerId++;

            socket.lobbyId = lobbyId;
            socket.playerId = playerId;

            lobby.players.set(socket, true);

            lobby.gamePlayers.set(playerId, {
                socket: socket,
                x: 0,
                y: 0,
                animation: "idle_down"
            });

            const existingPlayers = [];

            for (const [id, player] of lobby.gamePlayers) {
                if (id === playerId) {
                    continue;
                }

                existingPlayers.push({
                    id: id,
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

            broadcastToGame(
                lobby,
                {
                    type: "player_joined",
                    id: playerId,
                    x: 0,
                    y: 0,
                    animation: "idle_down"
                },
                socket
            );

            console.log(
                "Player",
                playerId,
                "joined game",
                lobby.name
            );

            broadcastLobbyList();
        }

        else if (message.type === "player_update") {
            const lobbyId = socket.lobbyId;
            const playerId = socket.playerId;

            if (!lobbyId || !playerId) {
                return;
            }

            const lobby = lobbies.get(lobbyId);

            if (!lobby) {
                return;
            }

            const player = lobby.gamePlayers.get(playerId);

            if (!player) {
                return;
            }

            player.x = Number(message.x);
            player.y = Number(message.y);
            player.animation = String(message.animation);

            broadcastToGame(
                lobby,
                {
                    type: "player_update",
                    id: playerId,
                    x: player.x,
                    y: player.y,
                    animation: player.animation
                },
                socket
            );
        }
    });

    socket.on("close", () => {
        console.log("Client disconnected");

        const lobbyId = socket.lobbyId;

        if (!lobbyId) {
            return;
        }

        const lobby = lobbies.get(lobbyId);

        if (!lobby) {
            return;
        }

        const playerId = socket.playerId;

        if (playerId && lobby.gamePlayers.has(playerId)) {
            lobby.gamePlayers.delete(playerId);

            broadcastToGame(lobby, {
                type: "player_left",
                id: playerId
            });
        }

        lobby.players.delete(socket);

        if (lobby.players.size === 0) {
            lobbies.delete(lobbyId);

            console.log(
                "Deleted empty lobby:",
                lobby.name
            );
        }

        broadcastLobbyList();
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log("================================");
    console.log("Multiplayer server started!");
    console.log("Port:", PORT);
    console.log("================================");
});