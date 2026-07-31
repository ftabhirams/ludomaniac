const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const path = require('path');

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

const COLOR_OFFSETS = { RED: 0, GREEN: 13, YELLOW: 26, BLUE: 39 };
const SAFE_GLOBAL_TILES = [0, 8, 13, 21, 26, 34, 39, 47];

io.on('connection', (socket) => {
    socket.on('joinGame', ({ room, name, dp }) => {
        socket.join(room);
        
        if (!rooms[room]) {
            rooms[room] = {
                players: [],
                turnIndex: 0,
                colors: ['RED', 'GREEN', 'YELLOW', 'BLUE'],
                diceValue: 0,
                hasRolled: false
            };
        }

        const roomData = rooms[room];
        let player = roomData.players.find(p => p.id === socket.id);

        if (!player) {
            if (roomData.players.length >= 4) {
                socket.emit('errorMsg', 'Match is full!');
                return;
            }
            const assignedColor = roomData.colors[roomData.players.length];
            // Save player's real display name and Chat App DP image URL
            player = { 
                id: socket.id, 
                name: name || 'Player', 
                dp: dp || 'https://via.placeholder.com/150',
                color: assignedColor, 
                tokens: [0, 0, 0, 0] 
            };
            roomData.players.push(player);
        }

        io.to(room).emit('updateGameState', {
            players: roomData.players,
            currentTurnColor: roomData.colors[roomData.turnIndex],
            diceValue: roomData.diceValue
        });
    });

    socket.on('rollDice', ({ room }) => {
        const roomData = rooms[room];
        if (!roomData || roomData.players.length === 0) return;

        const activePlayer = roomData.players[roomData.turnIndex];
        if (socket.id !== activePlayer.id) return socket.emit('errorMsg', "Not your turn!");
        if (roomData.hasRolled) return;

        const roll = Math.floor(Math.random() * 6) + 1;
        roomData.diceValue = roll;
        roomData.hasRolled = true;

        io.to(room).emit('diceRolled', {
            rollerName: activePlayer.name,
            diceValue: roll,
            currentTurnColor: activePlayer.color
        });

        // Auto pass turn if no valid moves possible
        const canMove = activePlayer.tokens.some(pos => {
            if (pos === 0) return roll === 6;
            return (pos + roll) <= 57;
        });

        if (!canMove) {
            setTimeout(() => {
                roomData.hasRolled = false;
                if (roll !== 6) {
                    roomData.turnIndex = (roomData.turnIndex + 1) % roomData.players.length;
                }
                io.to(room).emit('updateGameState', {
                    players: roomData.players,
                    currentTurnColor: roomData.colors[roomData.turnIndex],
                    diceValue: 0
                });
            }, 1200);
        }
    });

    socket.on('moveToken', ({ room, tokenIndex }) => {
        const roomData = rooms[room];
        if (!roomData || !roomData.hasRolled) return;

        const activePlayer = roomData.players[roomData.turnIndex];
        if (socket.id !== activePlayer.id) return;

        let tokenPos = activePlayer.tokens[tokenIndex];
        const roll = roomData.diceValue;

        if (tokenPos === 0) {
            if (roll === 6) {
                activePlayer.tokens[tokenIndex] = 1;
            } else {
                return;
            }
        } else {
            if (tokenPos + roll <= 57) {
                activePlayer.tokens[tokenIndex] += roll;
            } else {
                return;
            }
        }

        const newPos = activePlayer.tokens[tokenIndex];
        let capturedSomeone = false;

        if (newPos >= 1 && newPos <= 51) {
            const offset = COLOR_OFFSETS[activePlayer.color];
            const landingGlobalTile = (newPos - 1 + offset) % 52;

            if (!SAFE_GLOBAL_TILES.includes(landingGlobalTile)) {
                roomData.players.forEach(otherPlayer => {
                    if (otherPlayer.id !== activePlayer.id) {
                        const otherOffset = COLOR_OFFSETS[otherPlayer.color];
                        otherPlayer.tokens.forEach((otherPos, otherIdx) => {
                            if (otherPos >= 1 && otherPos <= 51) {
                                const otherGlobalTile = (otherPos - 1 + otherOffset) % 52;
                                if (otherGlobalTile === landingGlobalTile) {
                                    otherPlayer.tokens[otherIdx] = 0;
                                    capturedSomeone = true;
                                }
                            }
                        });
                    }
                });
            }
        }

        roomData.hasRolled = false;

        const hasWon = activePlayer.tokens.every(pos => pos === 57);
        if (hasWon) {
            io.to(room).emit('gameWon', { winnerName: activePlayer.name, winnerColor: activePlayer.color });
        }

        if (roll !== 6 && !capturedSomeone) {
            roomData.turnIndex = (roomData.turnIndex + 1) % roomData.players.length;
        }

        io.to(room).emit('updateGameState', {
            players: roomData.players,
            currentTurnColor: roomData.colors[roomData.turnIndex],
            diceValue: 0
        });
    });

    socket.on('disconnect', () => {
        for (const room in rooms) {
            rooms[room].players = rooms[room].players.filter(p => p.id !== socket.id);
            if (rooms[room].players.length === 0) delete rooms[room];
        }
    });
});

http.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const https = require('https');
const RENDER_SERVER_URL = "https://tapin-ludomaniac.onrender.com";

setInterval(() => {
    https.get(RENDER_SERVER_URL, (res) => {
        console.log("Keep-alive ping sent to Render!");
    }).on('error', (err) => {
        console.log("Ping error:", err.message);
    });
}, 10 * 60 * 1000);
