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
                hasRolled: false,
                isStarted: false,
                winners: [] // Tracks 1st, 2nd, 3rd place finishes
            };
        }

        const roomData = rooms[room];

        if (roomData.isStarted && !roomData.players.some(p => p.id === socket.id)) {
            return socket.emit('errorMsg', 'Match in progress! Cannot join now.');
        }

        let player = roomData.players.find(p => p.id === socket.id);

        if (!player) {
            if (roomData.players.length >= 4) return socket.emit('errorMsg', 'Match is full!');
            const assignedColor = roomData.colors[roomData.players.length];
            player = { 
                id: socket.id, 
                name: name || 'Player', 
                dp: dp || '',
                color: assignedColor, 
                tokens: [0, 0, 0, 0],
                finished: false
            };
            roomData.players.push(player);
        }

        if (roomData.players.length === 4) roomData.isStarted = true;

        io.to(room).emit('updateGameState', {
            players: roomData.players,
            currentTurnColor: roomData.colors[roomData.turnIndex],
            diceValue: roomData.diceValue,
            isStarted: roomData.isStarted,
            isHost: roomData.players[0].id === socket.id,
            winners: roomData.winners
        });
    });

    socket.on('startMatch', ({ room }) => {
        const roomData = rooms[room];
        if (!roomData) return;
        if (roomData.players[0] && roomData.players[0].id === socket.id) {
            roomData.isStarted = true;
            io.to(room).emit('updateGameState', {
                players: roomData.players,
                currentTurnColor: roomData.colors[roomData.turnIndex],
                diceValue: 0,
                isStarted: true,
                isHost: true,
                winners: roomData.winners
            });
        }
    });

    socket.on('rollDice', ({ room }) => {
        const roomData = rooms[room];
        if (!roomData || roomData.players.length === 0 || !roomData.isStarted) return;

        const activePlayer = roomData.players[roomData.turnIndex];
        if (socket.id !== activePlayer.id) return socket.emit('errorMsg', `It's ${activePlayer.name}'s turn!`);
        if (roomData.hasRolled) return;

        const roll = Math.floor(Math.random() * 6) + 1;
        roomData.diceValue = roll;
        roomData.hasRolled = true;

        io.to(room).emit('diceRolled', {
            rollerName: activePlayer.name,
            diceValue: roll,
            currentTurnColor: activePlayer.color
        });

        // Check if player has any legal moves
        const canMove = activePlayer.tokens.some(pos => {
            if (pos === 57) return false; // Already finished
            if (pos === 0) return roll === 6;
            return (pos + roll) <= 57;
        });

        if (!canMove) {
            setTimeout(() => {
                roomData.hasRolled = false;
                if (roll !== 6) {
                    advanceTurn(roomData);
                }
                io.to(room).emit('updateGameState', {
                    players: roomData.players,
                    currentTurnColor: roomData.colors[roomData.turnIndex],
                    diceValue: 0,
                    isStarted: roomData.isStarted,
                    winners: roomData.winners
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

        if (tokenPos === 57) return; // Token already inside home center

        const oldPos = tokenPos;

        if (tokenPos === 0) {
            if (roll === 6) activePlayer.tokens[tokenIndex] = 1;
            else return;
        } else {
            if (tokenPos + roll <= 57) activePlayer.tokens[tokenIndex] += roll;
            else return;
        }

        const newPos = activePlayer.tokens[tokenIndex];
        let capturedSomeone = false;

        // Check captures on unsafe circuit tiles
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
                                    otherPlayer.tokens[otherIdx] = 0; // Send back to base
                                    capturedSomeone = true;
                                }
                            }
                        });
                    }
                });
            }
        }

        roomData.hasRolled = false;

        // Check if this player finished all 4 pawns
        if (!activePlayer.finished && activePlayer.tokens.every(pos => pos === 57)) {
            activePlayer.finished = true;
            const rank = roomData.winners.length + 1;
            roomData.winners.push({
                name: activePlayer.name,
                color: activePlayer.color,
                rank: rank
            });
            io.to(room).emit('playerRankFinished', { name: activePlayer.name, color: activePlayer.color, rank });
        }

        // Advance turn if not 6 and no capture
        if (roll !== 6 && !capturedSomeone) {
            advanceTurn(roomData);
        }

        io.to(room).emit('tokenMovedStep', {
            playerColor: activePlayer.color,
            tokenIndex: tokenIndex,
            oldPos: oldPos,
            newPos: newPos,
            players: roomData.players,
            currentTurnColor: roomData.colors[roomData.turnIndex],
            winners: roomData.winners
        });
    });

    socket.on('disconnect', () => {
        for (const room in rooms) {
            rooms[room].players = rooms[room].players.filter(p => p.id !== socket.id);
            if (rooms[room].players.length === 0) delete rooms[room];
        }
    });
});

function advanceTurn(roomData) {
    let attempts = 0;
    do {
        roomData.turnIndex = (roomData.turnIndex + 1) % roomData.players.length;
        attempts++;
    } while (roomData.players[roomData.turnIndex].finished && attempts < roomData.players.length);
}

http.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const https = require('https');
const RENDER_SERVER_URL = "https://tapin-ludomaniac.onrender.com";
setInterval(() => {
    https.get(RENDER_SERVER_URL, () => {}).on('error', () => {});
}, 10 * 60 * 1000);
