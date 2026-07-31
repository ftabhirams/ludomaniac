const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});
const path = require('path');

const PORT = process.env.PORT || 3000;

// Serve static frontend from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

io.on('connection', (socket) => {
    console.log('User connected to Ludo Server:', socket.id);

    // Player joins a game room via automated Chat ID
    socket.on('joinGame', ({ room, name }) => {
        socket.join(room);
        
        if (!rooms[room]) {
            rooms[room] = {
                players: [],
                turnIndex: 0,
                colors: ['RED', 'GREEN', 'YELLOW', 'BLUE']
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
            player = { id: socket.id, name: name || 'Player', color: assignedColor };
            roomData.players.push(player);
        }

        io.to(room).emit('updatePlayers', {
            players: roomData.players,
            currentTurnColor: roomData.colors[roomData.turnIndex]
        });
    });

    // Handle Dice Roll Broadcast
    socket.on('rollDice', ({ room }) => {
        const roomData = rooms[room];
        if (!roomData || roomData.players.length === 0) return;

        const diceValue = Math.floor(Math.random() * 6) + 1;
        const activePlayer = roomData.players[roomData.turnIndex];

        // Rotate turn to next player
        roomData.turnIndex = (roomData.turnIndex + 1) % roomData.players.length;
        const nextPlayerColor = roomData.colors[roomData.turnIndex];

        io.to(room).emit('diceRolled', {
            rollerName: activePlayer ? activePlayer.name : 'Player',
            diceValue: diceValue,
            nextTurnColor: nextPlayerColor
        });
    });

    // Cleanup on disconnect
    socket.on('disconnect', () => {
        for (const room in rooms) {
            rooms[room].players = rooms[room].players.filter(p => p.id !== socket.id);
            if (rooms[room].players.length === 0) {
                delete rooms[room];
            } else {
                io.to(room).emit('updatePlayers', {
                    players: rooms[room].players,
                    currentTurnColor: rooms[room].colors[rooms[room].turnIndex || 0]
                });
            }
        }
    });
});

http.listen(PORT, () => {
    console.log(`Tap In Ludo Server running live on port ${PORT}`);
});