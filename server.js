const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, pingTimeout: 20000, pingInterval: 5000 });

app.use(express.static(path.join(__dirname, 'public')));

const MAP_W = 1200, MAP_H = 800, MAX_PLAYERS = 20;
const BALL_SPEED = 480, PLAYER_SPEED = 140, BALL_RADIUS = 10, PLAYER_RADIUS = 18, BALL_LIFE = 2.2;
const BOT_SHOOT_INTERVAL = 1800, BOT_MOVE_INTERVAL = 1200;

const COLORS = ['#FF4444','#FF8800','#FFEE00','#44FF44','#00CCFF','#AA44FF','#FF44AA','#00FFCC','#FF6622','#4488FF','#FF2288','#88FF00','#FF0088','#00FF88','#FFAA00','#0088FF','#FF00AA','#AA00FF','#00FFAA','#FFCC44'];
const BOT_NAMES = ['Rahim','Karim','Sumon','Rony','Bijoy','Arif','Nayem','Taufiq','Sohel','Tushar'];

let players = {}, bots = {}, balls = [], botIdCounter = 0, colorIndex = 0;

function nextColor() { return COLORS[(colorIndex++) % COLORS.length]; }
function randomPos() { return { x: 50 + Math.random()*(MAP_W-100), y: 50 + Math.random()*(MAP_H-100) }; }
function countHumans() { return Object.keys(players).length; }
function countBots() { return Object.keys(bots).length; }

function spawnBot() {
  const id = 'bot_' + (botIdCounter++);
  const pos = randomPos();
  bots[id] = { id, isBot:true, name:'Bot-'+BOT_NAMES[botIdCounter%BOT_NAMES.length], color:nextColor(), x:pos.x, y:pos.y, dx:0, dy:0, hp:100, score:0, colorHits:{}, alive:true, moveTimer:0, shootTimer:0, targetAngle:Math.random()*Math.PI*2 };
}
function removeBot(id) { delete bots[id]; }
function ensureBots() {
  const h = countHumans(), b = countBots();
  const desired = h === 0 ? 4 : Math.max(0, 2 - h);
  if (b < desired) for (let i=b;i<desired;i++) spawnBot();
  if (b > desired) { const ids=Object.keys(bots); for(let i=desired;i<ids.length;i++) removeBot(ids[i]); }
}
function spawnBall(ownerId, ownerColor, x, y, angle) {
  balls.push({ id:Math.random().toString(36).substr(2,8), ownerId, ownerColor, x, y, vx:Math.cos(angle)*BALL_SPEED, vy:Math.sin(angle)*BALL_SPEED, life:BALL_LIFE, radius:BALL_RADIUS });
}

let lastTick = Date.now();
setInterval(() => {
  const dt = (Date.now()-lastTick)/1000; lastTick = Date.now();
  const all = {...players,...bots};

  Object.values(bots).forEach(bot => {
    if (!bot.alive) return;
    bot.moveTimer -= dt*1000; bot.shootTimer -= dt*1000;
    if (bot.moveTimer <= 0) {
      bot.targetAngle += (Math.random()-0.5)*Math.PI;
      const humans = Object.values(players).filter(p=>p.alive);
      if (humans.length>0 && Math.random()<0.5) { const t=humans[Math.floor(Math.random()*humans.length)]; bot.targetAngle=Math.atan2(t.y-bot.y,t.x-bot.x); }
      bot.dx=Math.cos(bot.targetAngle)*PLAYER_SPEED; bot.dy=Math.sin(bot.targetAngle)*PLAYER_SPEED;
      bot.moveTimer=BOT_MOVE_INTERVAL+Math.random()*600;
    }
    bot.x=Math.max(PLAYER_RADIUS,Math.min(MAP_W-PLAYER_RADIUS,bot.x+bot.dx*dt));
    bot.y=Math.max(PLAYER_RADIUS,Math.min(MAP_H-PLAYER_RADIUS,bot.y+bot.dy*dt));
    if (bot.shootTimer<=0) {
      const humans=Object.values(players).filter(p=>p.alive);
      let angle=bot.targetAngle;
      if (humans.length>0) { const t=humans[Math.floor(Math.random()*humans.length)]; angle=Math.atan2(t.y-bot.y,t.x-bot.x)+(Math.random()-0.5)*0.4; }
      spawnBall(bot.id,bot.color,bot.x,bot.y,angle);
      bot.shootTimer=BOT_SHOOT_INTERVAL+Math.random()*800;
    }
  });

  balls = balls.filter(ball => {
    ball.x+=ball.vx*dt; ball.y+=ball.vy*dt; ball.life-=dt;
    if (ball.x<ball.radius||ball.x>MAP_W-ball.radius) { ball.vx*=-0.7; ball.x=Math.max(ball.radius,Math.min(MAP_W-ball.radius,ball.x)); }
    if (ball.y<ball.radius||ball.y>MAP_H-ball.radius) { ball.vy*=-0.7; ball.y=Math.max(ball.radius,Math.min(MAP_H-ball.radius,ball.y)); }
    if (ball.life<=0) return false;
    for (const [pid,p] of Object.entries(all)) {
      if (!p.alive||pid===ball.ownerId) continue;
      if (Math.hypot(ball.x-p.x,ball.y-p.y)<PLAYER_RADIUS+ball.radius) {
        p.hp=Math.max(0,p.hp-20);
        p.colorHits[ball.ownerColor]=(p.colorHits[ball.ownerColor]||0)+1;
        if (all[ball.ownerId]) all[ball.ownerId].score+=10;
        io.emit('hit',{targetId:pid,shooterId:ball.ownerId,color:ball.ownerColor,x:ball.x,y:ball.y,hp:p.hp});
        if (p.hp<=0 && p.alive) {
          p.alive=false;
          if (all[ball.ownerId]) all[ball.ownerId].score+=50;
          io.emit('eliminated',{targetId:pid,shooterId:ball.ownerId,shooterName:all[ball.ownerId]?.name||'?'});
          const respawnFn = () => {
            const target = players[pid]||bots[pid];
            if (target) { const pos=randomPos(); target.x=pos.x;target.y=pos.y;target.hp=100;target.alive=true;target.colorHits={}; io.emit('respawn',{id:pid}); }
          };
          setTimeout(respawnFn, 3000);
        }
        return false;
      }
    }
    return true;
  });

  io.emit('state',{
    players:Object.values(players).map(p=>({id:p.id,name:p.name,color:p.color,x:p.x,y:p.y,hp:p.hp,score:p.score,alive:p.alive,colorHits:p.colorHits,isBot:false})),
    bots:Object.values(bots).map(b=>({id:b.id,name:b.name,color:b.color,x:b.x,y:b.y,hp:b.hp,score:b.score,alive:b.alive,colorHits:b.colorHits,isBot:true})),
    balls:balls.map(b=>({id:b.id,x:b.x,y:b.y,color:b.ownerColor,radius:b.radius}))
  });
}, 1000/30);

io.on('connection', (socket) => {
  if (countHumans()>=MAX_PLAYERS) { socket.emit('full'); socket.disconnect(); return; }
  const pos=randomPos(), color=nextColor();
  players[socket.id]={id:socket.id,name:'Player'+(countHumans()+1),color,x:pos.x,y:pos.y,dx:0,dy:0,hp:100,score:0,alive:true,colorHits:{},isBot:false};
  socket.emit('init',{id:socket.id,color,mapW:MAP_W,mapH:MAP_H});
  ensureBots();
  io.emit('playerJoined',{id:socket.id,name:players[socket.id].name,count:countHumans()});
  console.log('Player joined:',socket.id,'Total:',countHumans());
  socket.on('setName',(name)=>{ if(players[socket.id]) players[socket.id].name=String(name).substring(0,16).replace(/[<>]/g,''); });
  socket.on('move',(d)=>{ const p=players[socket.id]; if(!p||!p.alive) return; p.x=Math.max(18,Math.min(MAP_W-18,d.x)); p.y=Math.max(18,Math.min(MAP_H-18,d.y)); });
  socket.on('shoot',(d)=>{ const p=players[socket.id]; if(!p||!p.alive) return; spawnBall(socket.id,p.color,p.x,p.y,d.angle); });
  socket.on('disconnect',()=>{ delete players[socket.id]; ensureBots(); io.emit('playerLeft',{id:socket.id,count:countHumans()}); console.log('Left:',socket.id,'Total:',countHumans()); });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log('Paintball Server on port',PORT));
