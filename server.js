const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});
const path = require('path');

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

io.on('connection', (socket) => {
    console.log('Player connected to Ludo Server:', socket.id);

    // Player joins a game room via automated Chat ID
    socket.on('joinGame', ({ room, name }) => {
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
                socket.emit('errorMsg', 'Match is full! (Max 4 players)');
                return;
            }
            const assignedColor = roomData.colors[roomData.players.length];
            // 4 pawns starting at position 0 (locked)
            player = { id: socket.id, name: name || 'Player', color: assignedColor, tokens: [0, 0, 0, 0] };
            roomData.players.push(player);
        }

        io.to(room).emit('updateGameState', {
            players: roomData.players,
            currentTurnColor: roomData.colors[roomData.turnIndex],
            diceValue: roomData.diceValue
        });
    });

    // Handle Dice Roll Broadcast
    socket.on('rollDice', ({ room }) => {
        const roomData = rooms[room];
        if (!roomData || roomData.players.length === 0) return;

        const activePlayer = roomData.players[roomData.turnIndex];
        if (socket.id !== activePlayer.id) return socket.emit('errorMsg', "Not your turn!");

        const roll = Math.floor(Math.random() * 6) + 1;
        roomData.diceValue = roll;
        roomData.hasRolled = true;

        io.to(room).emit('diceRolled', {
            rollerName: activePlayer.name,
            diceValue: roll,
            currentTurnColor: activePlayer.color
        });
    });

    // Handle Token/Pawn Move
    socket.on('moveToken', ({ room, tokenIndex }) => {
        const roomData = rooms[room];
        if (!roomData || !roomData.hasRolled) return;

        const activePlayer = roomData.players[roomData.turnIndex];
        if (socket.id !== activePlayer.id) return;

        let tokenPos = activePlayer.tokens[tokenIndex];
        const roll = roomData.diceValue;

        // Rule: Need 6 to unlock from home base (pos 0 -> pos 1)
        if (tokenPos === 0) {
            if (roll === 6) {
                activePlayer.tokens[tokenIndex] = 1;
            } else {
                return; // Cannot move locked pawn without rolling a 6
            }
        } else {
            // Move pawn forward along the track
            if (tokenPos + roll <= 57) {
                activePlayer.tokens[tokenIndex] += roll;
            }
        }

        roomData.hasRolled = false;

        // Win Condition Check: All 4 pawns at Home Center (pos 57)
        const hasWon = activePlayer.tokens.every(pos => pos === 57);
        if (hasWon) {
            io.to(room).emit('gameWon', {
                winnerName: activePlayer.name,
                winnerColor: activePlayer.color
            });
        }

        // Rule: Rolling a 6 grants an extra turn
        if (roll !== 6) {
            roomData.turnIndex = (roomData.turnIndex + 1) % roomData.players.length;
        }

        io.to(room).emit('updateGameState', {
            players: roomData.players,
            currentTurnColor: roomData.colors[roomData.turnIndex],
            diceValue: 0
        });
    });

    // Cleanup on disconnect
    socket.on('disconnect', () => {
        for (const room in rooms) {
            rooms[room].players = rooms[room].players.filter(p => p.id !== socket.id);
            if (rooms[room].players.length === 0) {
                delete rooms[room];
            } else {
                io.to(room).emit('updateGameState', {
                    players: rooms[room].players,
                    currentTurnColor: rooms[room].colors[rooms[room].turnIndex || 0],
                    diceValue: 0
                });
            }
        }
    });
});

http.listen(PORT, () => {
    console.log(`Tap In Ludo Server running live on port ${PORT}`);
});

// --- KEEP RENDER SERVER AWAKE 24/7 ---
const https = require('https');
const RENDER_SERVER_URL = "https://tapin-ludomaniac.onrender.com";

setInterval(() => {
    https.get(RENDER_SERVER_URL, (res) => {
        console.log("Keep-alive ping sent to Render!");
    }).on('error', (err) => {
        console.log("Ping error:", err.message);
    });
}, 10 * 60 * 1000); // Pings every 10 minutes
