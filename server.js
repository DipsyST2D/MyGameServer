const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 3000;
const GAME_PORT = 7777;

const lobbies = new Map();

let nextLobbyId = 1;

app.get("/", (req, res) => {
    res.send("Lobby server is running!");
});

function sendLobbyList() {
    const lobbyList = [];

    for (const lobby of lobbies.values()) {
        lobbyList.push({
            id: lobby.id,
            name: lobby.name,
            map: lobby.map,
            players: lobby.players,
            max_players: lobby.max_players
        });
    }

    const message = JSON.stringify({
        type: "lobby_list",
        lobbies: lobbyList
    });

    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }
}

wss.on("connection", (socket) => {
    console.log("Player connected");

    socket.send(JSON.stringify({
        type: "connected"
    }));

    sendLobbyList();

    socket.on("message", (data) => {
        let message;

        try {
            message = JSON.parse(data.toString());
        } catch {
            console.log("Received invalid JSON");
            return;
        }

        if (message.type === "create_lobby") {
            const lobbyId = nextLobbyId;

            nextLobbyId += 1;

            const lobby = {
                id: lobbyId,
                name: "Room " + lobbyId,
                map: message.map,
                players: 1,
                max_players: 8,
                game_port: GAME_PORT
            };

            lobbies.set(lobbyId, lobby);

            console.log("Created:", lobby.name, "|", lobby.map);

            socket.send(JSON.stringify({
                type: "lobby_created",
                lobby: lobby,
                host: true
            }));

            sendLobbyList();
        }

        if (message.type === "join_lobby") {
            const lobby = lobbies.get(Number(message.lobby_id));

            if (!lobby) {
                socket.send(JSON.stringify({
                    type: "error",
                    message: "Lobby does not exist."
                }));

                return;
            }

            if (lobby.players >= lobby.max_players) {
                socket.send(JSON.stringify({
                    type: "error",
                    message: "Lobby is full."
                }));

                return;
            }

            lobby.players += 1;

            console.log("Player joined:", lobby.name);

            socket.send(JSON.stringify({
                type: "lobby_joined",
                lobby: lobby,
                host: false
            }));

            sendLobbyList();
        }
    });

    socket.on("close", () => {
        console.log("Player disconnected");
    });
});

server.listen(PORT, () => {
    console.log("================================");
    console.log("Lobby server started!");
    console.log("Lobby port:", PORT);
    console.log("Game port:", GAME_PORT);
    console.log("================================");
});