const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Game rooms
const rooms = {};

io.on('connection', (socket) => {
  console.log('Ulanди:', socket.id);

  // Room yaratish
  socket.on('createRoom', ({ playerName }) => {
    const roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    rooms[roomCode] = {
      players: [{ id: socket.id, name: playerName, hp: 10 }],
      phase: 'lobby',
      round: 1
    };
    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode });
    io.to(roomCode).emit('updateRoom', rooms[roomCode]);
    console.log(`Room yaratildi: ${roomCode}`);
  });

  // Room ga ulanish
  socket.on('joinRoom', ({ roomCode, playerName }) => {
    const room = rooms[roomCode];
    if (!room) return socket.emit('error', 'Room topilmadi!');
    if (room.players.length >= 6) return socket.emit('error', 'Room to\'la!');
    if (room.phase !== 'lobby') return socket.emit('error', 'O\'yin boshlangan!');

    room.players.push({ id: socket.id, name: playerName, hp: 10 });
    socket.join(roomCode);
    socket.emit('roomJoined', { roomCode });
    io.to(roomCode).emit('updateRoom', room);
    console.log(`${playerName} ${roomCode} ga ulandi`);
  });

  // O'yinni boshlash
  socket.on('startGame', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;
    room.phase = 'playing';
    room.inputs = {};
    io.to(roomCode).emit('gameStarted', room);
  });

  // Son yuborish
  socket.on('submitNumber', ({ roomCode, number }) => {
    const room = rooms[roomCode];
    if (!room) return;

    room.inputs = room.inputs || {};
    room.inputs[socket.id] = number;

    const alive = room.players.filter(p => p.hp > 0);

    // Hamma yubordi?
    if (Object.keys(room.inputs).length === alive.length) {
      processRound(roomCode);
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log('Chiqdi:', socket.id);
    for (const code in rooms) {
      const room = rooms[code];
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        delete rooms[code];
      } else {
        io.to(code).emit('updateRoom', room);
      }
    }
  });
});

function processRound(roomCode) {
  const room = rooms[roomCode];
  const alive = room.players.filter(p => p.hp > 0);
  const inputs = room.inputs;

  const numbers = alive.map(p => inputs[p.id]);
  const avg = numbers.reduce((a, b) => a + b, 0) / numbers.length;
  const target = avg * 0.8;

  const diffs = alive.map(p => ({
    player: p,
    number: inputs[p.id],
    diff: Math.abs(inputs[p.id] - target)
  }));

  // Maxsus qoidalar
  const aliveCount = alive.length;

  // 4+ o'yinchi: duplicate son penalty
  if (aliveCount >= 4) {
    const numberCount = {};
    numbers.forEach(n => numberCount[n] = (numberCount[n] || 0) + 1);
    const duplicates = numbers.filter(n => numberCount[n] > 1);
    if (duplicates.length > 0) {
      diffs.forEach(d => {
        if (duplicates.includes(d.number)) d.penalty = true;
      });
    }
  }

  // 3 o'yinchi: rounded_target ga teng bo'lsa -2 HP
  if (aliveCount === 3) {
    const roundedTarget = Math.round(target);
    diffs.forEach(d => {
      if (d.number === roundedTarget) d.extraPenalty = true;
    });
  }

  // 2 o'yinchi: 0 vs 100
  if (aliveCount === 2) {
    const n0 = diffs.find(d => d.number === 0);
    const n100 = diffs.find(d => d.number === 100);
    if (n0 && n100) n0.penalty = true;
  }

  // Eng katta diff → penalti
  const maxDiff = Math.max(...diffs.map(d => d.diff));
  diffs.forEach(d => {
    if (d.diff === maxDiff) d.loser = true;
  });

  // HP kamaytirish
  diffs.forEach(d => {
    if (d.loser) d.player.hp -= 1;
    if (d.penalty) d.player.hp -= 1;
    if (d.extraPenalty) d.player.hp -= 2;
    if (d.player.hp < 0) d.player.hp = 0;
  });

  // O'lgan o'yinchilar
  room.players.forEach(p => {
    if (p.hp <= 0) p.dead = true;
  });

  const result = {
    round: room.round,
    target: target.toFixed(2),
    avg: avg.toFixed(2),
    results: diffs.map(d => ({
      name: d.player.name,
      number: d.number,
      diff: d.diff.toFixed(2),
      hp: d.player.hp,
      loser: d.loser || false,
      penalty: d.penalty || false,
      extraPenalty: d.extraPenalty || false,
      dead: d.player.dead || false
    })),
    players: room.players
  };

  room.round++;
  room.inputs = {};

  // G'olib tekshirish
  const surviving = room.players.filter(p => !p.dead);
  if (surviving.length === 1) {
    io.to(roomCode).emit('gameOver', { winner: surviving[0].name, result });
    delete rooms[roomCode];
  } else {
    io.to(roomCode).emit('roundResult', result);
  }
}

server.listen(3000, '0.0.0.0', () => {
  console.log('✅ Server ishlamoqda: http://localhost:3000');
});