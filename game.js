(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const setupPanel = document.getElementById("setup-panel");
  const startBtn = document.getElementById("start-btn");
  const modeSelect = document.getElementById("mode-select");
  const difficultySelect = document.getElementById("difficulty-select");
  const difficultyLabel = document.getElementById("difficulty-label");
  const playerNameInput = document.getElementById("player-name");

  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const overlayBtn = document.getElementById("overlay-btn");

  const scoreboardEl = document.getElementById("scoreboard");
  const roundEl = document.getElementById("round-label");
  const statusEl = document.getElementById("status-label");
  const controlsText = document.getElementById("controls-text");

  const CELL = 52;
  const COLS = Math.floor(canvas.width / CELL);
  const ROWS = Math.floor(canvas.height / CELL);
  const WALL = 5;
  const MAZE_EXTRA_OPENINGS = 0.38;
  const BASE_TANK_SPEED = 128;
  const BULLET_SPEED = 285;
  const POWERUP_TYPES = [
    "double_damage",
    "extra_hp",
    "rapid_fire",
    "sniper_rounds",
    "bouncy_rounds",
    "big_rounds",
  ];
  const POWERUPS_PER_ROUND = 4;
  const POWERUP_MIN_SPAWN_DELAY = 2.5;
  const POWERUP_MAX_SPAWN_DELAY = 7;

  const FIXED_STEP = 1 / 30;
  const MAX_FRAME = 0.1;

  const state = {
    phase: "idle",
    mode: "ai",
    aiDifficulty: "medium",
    player1Name: "Player 1",
    player2Name: "Player 2",
    round: 1,
    wins1: 0,
    wins2: 0,
    targetWins: 3,
    walls: [],
    tanks: [],
    bullets: [],
    particles: [],
    powerups: [],
    pendingPowerups: 0,
    nextPowerupIn: 0,
    keys: {},
    prevKeys: {},
    mouse: { x: canvas.width * 0.5, y: canvas.height * 0.5, down: false },
    betweenRoundsTimer: 0,
    countdownReason: "",
    roundWinnerId: 0,
    aiTarget: { x: 0, y: 0, timer: 0 },
  };

  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function intersectsRectCircle(rect, x, y, r) {
    const nx = clamp(x, rect.x, rect.x + rect.w);
    const ny = clamp(y, rect.y, rect.y + rect.h);
    const dx = x - nx;
    const dy = y - ny;
    return dx * dx + dy * dy <= r * r;
  }

  function lineOfSight(a, b) {
    const segments = 26;
    for (let i = 1; i < segments; i += 1) {
      const x = a.x + (b.x - a.x) * (i / segments);
      const y = a.y + (b.y - a.y) * (i / segments);
      if (state.walls.some((wall) => intersectsRectCircle(wall, x, y, 2))) {
        return false;
      }
    }
    return true;
  }

  function spawnTank(id, x, y, color) {
    return {
      id,
      x,
      y,
      r: 13,
      speed: BASE_TANK_SPEED,
      angle: 0,
      maxHp: 100,
      hp: 100,
      reload: 0,
      color,
      alive: true,
      damageMult: 1,
      powerTimers: {
        doubleDamage: 0,
        rapidFire: 0,
        sniperRounds: 0,
        bouncyRounds: 0,
        bigRounds: 0,
      },
      lastMoveX: id === 1 ? 1 : -1,
      lastMoveY: 0,
    };
  }

  function getAiProfile() {
    if (state.aiDifficulty === "easy") {
      return {
        speedMult: 0.82,
        reload: 0.6,
        shotRange: 320,
        retargetMin: 1.2,
        retargetMax: 1.8,
        aimJitter: 0.2,
      };
    }
    if (state.aiDifficulty === "hard") {
      return {
        speedMult: 1.2,
        reload: 0.2,
        shotRange: 560,
        retargetMin: 0.45,
        retargetMax: 0.8,
        aimJitter: 0.04,
      };
    }
    return {
      speedMult: 1,
      reload: 0.32,
      shotRange: 460,
      retargetMin: 0.8,
      retargetMax: 1.2,
      aimJitter: 0.1,
    };
  }

  function powerupColor(type) {
    if (type === "double_damage") return "#ff6f3c";
    if (type === "extra_hp") return "#4dff88";
    if (type === "sniper_rounds") return "#ffd95c";
    if (type === "bouncy_rounds") return "#d08fff";
    if (type === "big_rounds") return "#ff8bc4";
    return "#4dd1ff";
  }

  function powerupLabel(type) {
    if (type === "double_damage") return "2X";
    if (type === "extra_hp") return "HP";
    if (type === "sniper_rounds") return "SNP";
    if (type === "bouncy_rounds") return "BOU";
    if (type === "big_rounds") return "BIG";
    return "RF";
  }

  function getBulletType(tank) {
    if (tank.powerTimers.sniperRounds > 0) return "sniper";
    if (tank.powerTimers.bouncyRounds > 0) return "bouncy";
    if (tank.powerTimers.bigRounds > 0) return "big";
    return "normal";
  }

  function clearBulletTypeTimers(tank) {
    tank.powerTimers.sniperRounds = 0;
    tank.powerTimers.bouncyRounds = 0;
    tank.powerTimers.bigRounds = 0;
  }

  function generateMazeWalls() {
    const grid = Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, () => ({ visited: false, walls: [1, 1, 1, 1] }))
    );
    const stack = [[0, 0]];
    grid[0][0].visited = true;
    const dirs = [
      [0, -1, 0, 2],
      [1, 0, 1, 3],
      [0, 1, 2, 0],
      [-1, 0, 3, 1],
    ];

    while (stack.length > 0) {
      const [cx, cy] = stack[stack.length - 1];
      const choices = dirs
        .map(([dx, dy, outWall, inWall]) => ({ nx: cx + dx, ny: cy + dy, outWall, inWall }))
        .filter(({ nx, ny }) => nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS && !grid[ny][nx].visited);

      if (choices.length === 0) {
        stack.pop();
      } else {
        const pick = choices[(Math.random() * choices.length) | 0];
        grid[cy][cx].walls[pick.outWall] = 0;
        grid[pick.ny][pick.nx].walls[pick.inWall] = 0;
        grid[pick.ny][pick.nx].visited = true;
        stack.push([pick.nx, pick.ny]);
      }
    }

    const walls = [];
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const cell = grid[y][x];
        const px = x * CELL;
        const py = y * CELL;

        if (cell.walls[0]) walls.push({ x: px, y: py, w: CELL, h: WALL });
        if (cell.walls[1]) walls.push({ x: px + CELL - WALL, y: py, w: WALL, h: CELL });
        if (cell.walls[2]) walls.push({ x: px, y: py + CELL - WALL, w: CELL, h: WALL });
        if (cell.walls[3]) walls.push({ x: px, y: py, w: WALL, h: CELL });
      }
    }

    // Simplify the maze by removing a portion of interior walls.
    const interiorWalls = walls.filter(
      (wall) => wall.x > 0 && wall.y > 0 && wall.x + wall.w < canvas.width && wall.y + wall.h < canvas.height
    );
    const removeCount = Math.floor(interiorWalls.length * MAZE_EXTRA_OPENINGS);
    for (let i = interiorWalls.length - 1; i > 0; i -= 1) {
      const j = (Math.random() * (i + 1)) | 0;
      const tmp = interiorWalls[i];
      interiorWalls[i] = interiorWalls[j];
      interiorWalls[j] = tmp;
    }

    const removedWalls = new Set(interiorWalls.slice(0, removeCount));
    return walls.filter((wall) => !removedWalls.has(wall));
  }

  function isSpawnValid(x, y, radius = 15) {
    if (x < radius + 10 || y < radius + 10 || x > canvas.width - radius - 10 || y > canvas.height - radius - 10) {
      return false;
    }
    return !state.walls.some((wall) => intersectsRectCircle(wall, x, y, radius + 5));
  }

  function randomSpawn(awayFrom) {
    const minDistance = Math.min(canvas.width, canvas.height) * 0.42;
    for (let i = 0; i < 900; i += 1) {
      const x = rand(26, canvas.width - 26);
      const y = rand(26, canvas.height - 26);
      if (!isSpawnValid(x, y)) {
        continue;
      }
      if (awayFrom && Math.hypot(x - awayFrom.x, y - awayFrom.y) < minDistance) {
        continue;
      }
      return { x, y };
    }
    return awayFrom ? { x: canvas.width - 80, y: canvas.height - 80 } : { x: 80, y: 80 };
  }

  function randomPowerupPoint() {
    for (let i = 0; i < 700; i += 1) {
      const x = rand(24, canvas.width - 24);
      const y = rand(24, canvas.height - 24);
      if (!isSpawnValid(x, y, 10)) {
        continue;
      }
      if (state.tanks.some((tank) => Math.hypot(tank.x - x, tank.y - y) < 70)) {
        continue;
      }
      if (state.powerups.some((p) => Math.hypot(p.x - x, p.y - y) < 46)) {
        continue;
      }
      return { x, y };
    }
    return null;
  }

  function scheduleRoundPowerups() {
    state.pendingPowerups = POWERUPS_PER_ROUND;
    state.nextPowerupIn = rand(POWERUP_MIN_SPAWN_DELAY, POWERUP_MAX_SPAWN_DELAY);
  }

  function spawnOnePowerup() {
    const pos = randomPowerupPoint();
    if (!pos) {
      return false;
    }
    const type = POWERUP_TYPES[(Math.random() * POWERUP_TYPES.length) | 0];
    state.powerups.push({ x: pos.x, y: pos.y, r: 10, type });
    return true;
  }

  function updatePowerupSpawning(dt) {
    if (state.phase !== "playing" || state.pendingPowerups <= 0) {
      return;
    }

    state.nextPowerupIn -= dt;
    if (state.nextPowerupIn > 0) {
      return;
    }

    spawnOnePowerup();
    state.pendingPowerups -= 1;
    if (state.pendingPowerups > 0) {
      state.nextPowerupIn = rand(POWERUP_MIN_SPAWN_DELAY, POWERUP_MAX_SPAWN_DELAY);
    }
  }

  function applyPowerup(tank, type) {
    if (type === "double_damage") {
      tank.damageMult = 2;
      tank.powerTimers.doubleDamage = 10;
      return;
    }
    if (type === "rapid_fire") {
      tank.powerTimers.rapidFire = 8;
      return;
    }

    if (type === "sniper_rounds") {
      clearBulletTypeTimers(tank);
      tank.powerTimers.sniperRounds = 10;
      return;
    }

    if (type === "bouncy_rounds") {
      clearBulletTypeTimers(tank);
      tank.powerTimers.bouncyRounds = 10;
      return;
    }

    if (type === "big_rounds") {
      clearBulletTypeTimers(tank);
      tank.powerTimers.bigRounds = 10;
      return;
    }

    tank.maxHp = Math.max(tank.maxHp, 150);
    tank.hp = Math.min(tank.maxHp, tank.hp + 50);
  }

  function updatePowerups(dt) {
    for (const tank of state.tanks) {
      if (!tank.alive) {
        continue;
      }

      tank.powerTimers.doubleDamage = Math.max(0, tank.powerTimers.doubleDamage - dt);
      tank.powerTimers.rapidFire = Math.max(0, tank.powerTimers.rapidFire - dt);
      tank.powerTimers.sniperRounds = Math.max(0, tank.powerTimers.sniperRounds - dt);
      tank.powerTimers.bouncyRounds = Math.max(0, tank.powerTimers.bouncyRounds - dt);
      tank.powerTimers.bigRounds = Math.max(0, tank.powerTimers.bigRounds - dt);
      tank.damageMult = tank.powerTimers.doubleDamage > 0 ? 2 : 1;
    }

    state.powerups = state.powerups.filter((powerup) => {
      for (const tank of state.tanks) {
        if (!tank.alive) {
          continue;
        }
        if (Math.hypot(tank.x - powerup.x, tank.y - powerup.y) <= tank.r + powerup.r) {
          applyPowerup(tank, powerup.type);
          return false;
        }
      }
      return true;
    });
  }

  function newRoundArena() {
    state.walls = generateMazeWalls();
    const spawn1 = randomSpawn();
    const spawn2 = randomSpawn(spawn1);
    state.tanks = [spawnTank(1, spawn1.x, spawn1.y, "#2f7cff"), spawnTank(2, spawn2.x, spawn2.y, "#ff4343")];
    state.bullets = [];
    state.particles = [];
    state.powerups = [];
    state.aiTarget = { x: spawn1.x, y: spawn1.y, timer: 0 };
    scheduleRoundPowerups();
  }

  function showOverlay(title, text, buttonVisible = false, buttonText = "Play Again") {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlayBtn.textContent = buttonText;
    overlayBtn.hidden = !buttonVisible;
    overlay.classList.add("visible");
  }

  function hideOverlay() {
    overlay.classList.remove("visible");
  }

  function updateHud() {
    scoreboardEl.textContent = `${state.player1Name}: ${state.wins1} | ${state.player2Name}: ${state.wins2}`;
    roundEl.textContent = `Round: ${state.round}`;

    if (state.phase === "playing") {
      statusEl.textContent = "Status: Battle in progress";
    } else if (state.phase === "countdown") {
      statusEl.textContent = `Status: Next round in ${Math.ceil(state.betweenRoundsTimer)}...`;
    } else if (state.phase === "round-end") {
      statusEl.textContent = "Status: Round complete";
    } else if (state.phase === "match-over") {
      statusEl.textContent = "Status: Match over";
    } else {
      statusEl.textContent = "Status: Waiting to start";
    }
  }

  function startCountdown(seconds, withRoundMessage) {
    state.phase = "countdown";
    state.betweenRoundsTimer = seconds;
    state.countdownReason = withRoundMessage ? "next-round" : "round-start";
    if (withRoundMessage) {
      const winnerName = state.roundWinnerId === 1 ? state.player1Name : state.player2Name;
      showOverlay(
        `Player ${state.roundWinnerId} Wins Round`,
        `${winnerName} scored this round. Next round starts in ${Math.ceil(state.betweenRoundsTimer)}...`
      );
    } else {
      showOverlay("Get Ready", `Round ${state.round} starts in ${Math.ceil(state.betweenRoundsTimer)}...`);
    }
  }

  function beginMatch() {
    state.round = 1;
    state.wins1 = 0;
    state.wins2 = 0;
    state.phase = "countdown";
    state.roundWinnerId = 0;
    newRoundArena();
    startCountdown(3, false);
    updateHud();
  }

  function moveTank(tank, dt, moveX, moveY) {
    const mag = Math.hypot(moveX, moveY) || 1;
    const dx = (moveX / mag) * tank.speed * dt;
    const dy = (moveY / mag) * tank.speed * dt;
    const nx = tank.x + dx;
    const ny = tank.y + dy;

    if (!state.walls.some((wall) => intersectsRectCircle(wall, nx, tank.y, tank.r))) {
      tank.x = nx;
    }
    if (!state.walls.some((wall) => intersectsRectCircle(wall, tank.x, ny, tank.r))) {
      tank.y = ny;
    }

    tank.x = clamp(tank.x, tank.r, canvas.width - tank.r);
    tank.y = clamp(tank.y, tank.r, canvas.height - tank.r);

    if (Math.abs(moveX) > 0 || Math.abs(moveY) > 0) {
      tank.lastMoveX = moveX;
      tank.lastMoveY = moveY;
    }
  }

  function resolveTankCollisions() {
    if (state.tanks.length < 2) {
      return;
    }

    const a = state.tanks[0];
    const b = state.tanks[1];
    if (!a || !b || !a.alive || !b.alive) {
      return;
    }

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.hypot(dx, dy);
    const minDistance = a.r + b.r + 2;
    if (distance >= minDistance) {
      return;
    }

    const nx = distance > 0 ? dx / distance : 1;
    const ny = distance > 0 ? dy / distance : 0;
    const push = (minDistance - distance) * 0.5;

    const nextAx = a.x - nx * push;
    const nextAy = a.y - ny * push;
    const nextBx = b.x + nx * push;
    const nextBy = b.y + ny * push;

    if (!state.walls.some((wall) => intersectsRectCircle(wall, nextAx, nextAy, a.r))) {
      a.x = clamp(nextAx, a.r, canvas.width - a.r);
      a.y = clamp(nextAy, a.r, canvas.height - a.r);
    }
    if (!state.walls.some((wall) => intersectsRectCircle(wall, nextBx, nextBy, b.r))) {
      b.x = clamp(nextBx, b.r, canvas.width - b.r);
      b.y = clamp(nextBy, b.r, canvas.height - b.r);
    }
  }

  function shootBullet(tank, angle, cooldown = 0.32) {
    if (!tank.alive || tank.reload > 0) {
      return;
    }
    const muzzle = tank.r + 9;
    const bulletType = getBulletType(tank);
    const speed =
      bulletType === "sniper" ? BULLET_SPEED * 1.55 : bulletType === "bouncy" ? BULLET_SPEED * 0.92 : BULLET_SPEED;
    const radius = bulletType === "big" ? 6 : 4;
    const life = bulletType === "sniper" ? 2.6 : bulletType === "bouncy" ? 2.9 : bulletType === "big" ? 2.5 : 2.2;
    const bounces = bulletType === "bouncy" ? 3 : 1;
    state.bullets.push({
      ownerId: tank.id,
      x: tank.x + Math.cos(angle) * muzzle,
      y: tank.y + Math.sin(angle) * muzzle,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: radius,
      life,
      type: bulletType,
      bounces,
    });
    tank.reload = tank.powerTimers.rapidFire > 0 ? Math.min(cooldown, 0.16) : cooldown;
  }

  function isPressed(code) {
    return Boolean(state.keys[code]);
  }

  function justPressed(code) {
    return Boolean(state.keys[code]) && !Boolean(state.prevKeys[code]);
  }

  function updatePlayerOne(dt) {
    const p1 = state.tanks[0];
    let mx = 0;
    let my = 0;
    if (isPressed("KeyW")) my -= 1;
    if (isPressed("KeyS")) my += 1;
    if (isPressed("KeyA")) mx -= 1;
    if (isPressed("KeyD")) mx += 1;

    moveTank(p1, dt, mx, my);
    p1.angle = Math.atan2(state.mouse.y - p1.y, state.mouse.x - p1.x);

    if (state.mouse.down || justPressed("KeyF")) {
      shootBullet(p1, p1.angle);
    }
  }

  function updatePlayerTwoHuman(dt) {
    const p2 = state.tanks[1];
    let mx = 0;
    let my = 0;
    if (isPressed("ArrowUp")) my -= 1;
    if (isPressed("ArrowDown")) my += 1;
    if (isPressed("ArrowLeft")) mx -= 1;
    if (isPressed("ArrowRight")) mx += 1;

    moveTank(p2, dt, mx, my);
    if (mx !== 0 || my !== 0) {
      p2.angle = Math.atan2(my, mx);
    } else {
      p2.angle = Math.atan2(p2.lastMoveY, p2.lastMoveX);
    }

    if (justPressed("KeyL")) {
      shootBullet(p2, p2.angle);
    }
  }

  function updatePlayerTwoAI(dt) {
    const p1 = state.tanks[0];
    const ai = state.tanks[1];
    if (!p1 || !p1.alive || !ai || !ai.alive) {
      return;
    }
    const aiProfile = getAiProfile();
    ai.speed = BASE_TANK_SPEED * aiProfile.speedMult;
    const sees = lineOfSight(ai, p1);

    state.aiTarget.timer -= dt;
    if (sees) {
      state.aiTarget.x = p1.x;
      state.aiTarget.y = p1.y;
      state.aiTarget.timer = 0.5;
    } else if (state.aiTarget.timer <= 0 || Math.hypot(ai.x - state.aiTarget.x, ai.y - state.aiTarget.y) < 18) {
      const next = randomSpawn(p1);
      state.aiTarget.x = next.x;
      state.aiTarget.y = next.y;
      state.aiTarget.timer = rand(aiProfile.retargetMin, aiProfile.retargetMax);
    }

    const ax = state.aiTarget.x - ai.x;
    const ay = state.aiTarget.y - ai.y;
    moveTank(ai, dt, ax, ay);
    ai.angle = Math.atan2(p1.y - ai.y, p1.x - ai.x);

    if (sees && Math.hypot(p1.x - ai.x, p1.y - ai.y) < aiProfile.shotRange) {
      const jitteredAngle = ai.angle + rand(-aiProfile.aimJitter, aiProfile.aimJitter);
      shootBullet(ai, jitteredAngle, aiProfile.reload);
    }
  }

  function updateBullets(dt) {
    for (const bullet of state.bullets) {
      bullet.life -= dt;
      const totalMove = Math.hypot(bullet.vx * dt, bullet.vy * dt);
      const steps = Math.max(1, Math.ceil(totalMove / (bullet.r * 0.75)));
      const stepDt = dt / steps;

      for (let step = 0; step < steps; step += 1) {
        bullet.x += bullet.vx * stepDt;
        bullet.y += bullet.vy * stepDt;

        if (bullet.x < bullet.r || bullet.x > canvas.width - bullet.r) {
          bullet.vx *= -1;
          bullet.bounces -= 1;
          bullet.x = clamp(bullet.x, bullet.r, canvas.width - bullet.r);
        }
        if (bullet.y < bullet.r || bullet.y > canvas.height - bullet.r) {
          bullet.vy *= -1;
          bullet.bounces -= 1;
          bullet.y = clamp(bullet.y, bullet.r, canvas.height - bullet.r);
        }

        for (const wall of state.walls) {
          if (!intersectsRectCircle(wall, bullet.x, bullet.y, bullet.r)) {
            continue;
          }
          const centerX = wall.x + wall.w * 0.5;
          const centerY = wall.y + wall.h * 0.5;
          const dx = bullet.x - centerX;
          const dy = bullet.y - centerY;
          if (Math.abs(dx / wall.w) > Math.abs(dy / wall.h)) {
            bullet.vx *= -1;
          } else {
            bullet.vy *= -1;
          }
          bullet.bounces -= 1;
          break;
        }

        let hitTank = false;
        for (const tank of state.tanks) {
          if (!tank.alive || tank.id === bullet.ownerId) {
            continue;
          }
          if (Math.hypot(tank.x - bullet.x, tank.y - bullet.y) <= tank.r + bullet.r) {
            const shooter = state.tanks.find((t) => t.id === bullet.ownerId);
            const bulletBonus = bullet.type === "big" ? 1.2 : bullet.type === "sniper" ? 1.1 : 1;
            const damage = 25 * (shooter ? shooter.damageMult : 1) * bulletBonus;
            tank.hp -= damage;
            bullet.life = 0;
            hitTank = true;
            if (tank.hp <= 0) {
              tank.alive = false;
              spawnExplosion(tank.x, tank.y, tank.color);
            }
            break;
          }
        }

        if (hitTank || bullet.life <= 0 || bullet.bounces < 0) {
          break;
        }
      }
    }

    state.bullets = state.bullets.filter((bullet) => bullet.life > 0 && bullet.bounces >= 0);
  }

  function spawnExplosion(x, y, baseColor) {
    for (let i = 0; i < 34; i += 1) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(40, 260);
      state.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: rand(3, 7),
        life: rand(0.45, 0.95),
        maxLife: 1,
        color: i % 2 === 0 ? "#ffd447" : baseColor,
      });
    }
  }

  function updateParticles(dt) {
    for (const p of state.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
    }
    state.particles = state.particles.filter((p) => p.life > 0);
  }

  function onRoundWin(winnerId) {
    state.phase = "round-end";
    state.roundWinnerId = winnerId;

    if (winnerId === 1) {
      state.wins1 += 1;
    } else {
      state.wins2 += 1;
    }
    updateHud();

    if (state.wins1 >= state.targetWins || state.wins2 >= state.targetWins) {
      const winnerName = winnerId === 1 ? state.player1Name : state.player2Name;
      state.phase = "match-over";
      showOverlay("Match Winner!", `${winnerName} wins the match ${state.targetWins}-${Math.min(state.wins1, state.wins2)}.`, true);
      return;
    }

    state.round += 1;
    newRoundArena();
    startCountdown(3, true);
  }

  function updateRoundFlow(dt) {
    if (state.phase === "countdown") {
      state.betweenRoundsTimer -= dt;
      const seconds = Math.max(0, Math.ceil(state.betweenRoundsTimer));
      if (state.countdownReason === "next-round") {
        const winnerName = state.roundWinnerId === 1 ? state.player1Name : state.player2Name;
        overlayText.textContent = `${winnerName} scored this round. Next round starts in ${seconds}...`;
      } else {
        overlayText.textContent = `Round ${state.round} starts in ${seconds}...`;
      }
      if (state.betweenRoundsTimer <= 0) {
        state.phase = "playing";
        state.countdownReason = "";
        hideOverlay();
      }
      return;
    }

    if (state.phase !== "playing") {
      return;
    }

    const p1Alive = state.tanks[0] && state.tanks[0].alive;
    const p2Alive = state.tanks[1] && state.tanks[1].alive;

    if (!p1Alive && p2Alive) {
      onRoundWin(2);
    } else if (!p2Alive && p1Alive) {
      onRoundWin(1);
    }
  }

  function update(dt) {
    for (const tank of state.tanks) {
      tank.reload = Math.max(0, tank.reload - dt);
    }

    if (state.phase === "playing") {
      updatePlayerOne(dt);
      if (state.mode === "2p") {
        updatePlayerTwoHuman(dt);
      } else {
        updatePlayerTwoAI(dt);
      }

      resolveTankCollisions();
      updatePowerupSpawning(dt);
      updatePowerups(dt);
      updateBullets(dt);
    }

    updateParticles(dt);
    updateRoundFlow(dt);
    updateHud();
    state.prevKeys = { ...state.keys };
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    g.addColorStop(0, "#07173a");
    g.addColorStop(1, "#153067");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = "#a3d8ff";
    for (let x = 0; x < canvas.width; x += CELL) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += CELL) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawWalls() {
    for (const wall of state.walls) {
      ctx.fillStyle = "#f8e38e";
      ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
      ctx.fillStyle = "#d2b24f";
      ctx.fillRect(wall.x + 1, wall.y + 1, Math.max(0, wall.w - 2), Math.max(0, wall.h - 2));
    }
  }

  function drawTank(tank) {
    if (!tank || !tank.alive) {
      return;
    }
    ctx.save();
    ctx.translate(tank.x, tank.y);
    ctx.rotate(tank.angle);

    ctx.fillStyle = tank.color;
    ctx.fillRect(-tank.r, -tank.r, tank.r * 2, tank.r * 2);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-5, -5, 10, 10);

    ctx.fillStyle = "#0d1730";
    ctx.fillRect(0, -3, tank.r + 12, 6);

    ctx.restore();
  }

  function drawBullets() {
    for (const bullet of state.bullets) {
      if (bullet.type === "sniper") {
        ctx.fillStyle = "#ffe98a";
      } else if (bullet.type === "bouncy") {
        ctx.fillStyle = "#dba7ff";
      } else if (bullet.type === "big") {
        ctx.fillStyle = "#ff9acc";
      } else {
        ctx.fillStyle = bullet.ownerId === 1 ? "#6ec3ff" : "#ff8b8b";
      }
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, bullet.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawPowerups() {
    for (const powerup of state.powerups) {
      ctx.fillStyle = powerupColor(powerup.type);
      ctx.beginPath();
      ctx.arc(powerup.x, powerup.y, powerup.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#0d1730";
      ctx.font = "bold 10px Trebuchet MS";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(powerupLabel(powerup.type), powerup.x, powerup.y + 0.5);
    }
  }

  function drawParticles() {
    for (const p of state.particles) {
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawHpBars() {
    for (const tank of state.tanks) {
      if (!tank.alive) {
        continue;
      }
      const width = 36;
      const hpPct = clamp(tank.hp / tank.maxHp, 0, 1);
      const x = tank.x - width / 2;
      const y = tank.y - tank.r - 14;
      ctx.fillStyle = "#0f172e";
      ctx.fillRect(x, y, width, 5);
      ctx.fillStyle = tank.id === 1 ? "#6ec3ff" : "#ff8b8b";
      ctx.fillRect(x, y, width * hpPct, 5);

      if (
        tank.powerTimers.doubleDamage > 0 ||
        tank.powerTimers.rapidFire > 0 ||
        tank.powerTimers.sniperRounds > 0 ||
        tank.powerTimers.bouncyRounds > 0 ||
        tank.powerTimers.bigRounds > 0
      ) {
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 9px Trebuchet MS";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        const tags = [];
        if (tank.powerTimers.doubleDamage > 0) tags.push("2X");
        if (tank.powerTimers.rapidFire > 0) tags.push("RF");
        if (tank.powerTimers.sniperRounds > 0) tags.push("SNP");
        if (tank.powerTimers.bouncyRounds > 0) tags.push("BOU");
        if (tank.powerTimers.bigRounds > 0) tags.push("BIG");
        const tag = tags.join("+");
        ctx.fillText(tag, tank.x, y - 2);
      }
    }
  }

  function render() {
    drawBackground();
    drawWalls();
    drawPowerups();
    drawBullets();
    drawParticles();
    drawTank(state.tanks[0]);
    drawTank(state.tanks[1]);
    drawHpBars();
  }

  let previousTime = performance.now();
  let accumulator = 0;

  function frame(now) {
    const delta = Math.min(MAX_FRAME, (now - previousTime) / 1000);
    previousTime = now;
    accumulator += delta;

    while (accumulator >= FIXED_STEP) {
      update(FIXED_STEP);
      accumulator -= FIXED_STEP;
    }

    render();
    requestAnimationFrame(frame);
  }

  function startFromSetup() {
    const rawName = playerNameInput.value.trim();
    state.player1Name = rawName || "Player 1";
    state.mode = modeSelect.value;
    state.aiDifficulty = difficultySelect.value;
    state.player2Name = state.mode === "2p" ? "Player 2" : "AI";
    controlsText.textContent =
      state.mode === "2p"
        ? "P1: WASD + Left Click/F. P2: Arrow Keys + L."
        : `P1: WASD + Left Click/F. Opponent: AI tank (${state.aiDifficulty}).`;

    setupPanel.style.display = "none";
    beginMatch();
  }

  function updateDifficultyVisibility() {
    const hidden = modeSelect.value !== "ai";
    difficultySelect.hidden = hidden;
    difficultyLabel.hidden = hidden;
  }

  function resetForReplay() {
    state.phase = "idle";
    state.bullets = [];
    state.particles = [];
    state.walls = [];
    state.tanks = [];
    setupPanel.style.display = "grid";
    showOverlay("Maze Warface", "Enter your name and start the match.");
    updateHud();
  }

  startBtn.addEventListener("click", startFromSetup);
  overlayBtn.addEventListener("click", resetForReplay);
  modeSelect.addEventListener("change", updateDifficultyVisibility);

  document.addEventListener("keydown", (event) => {
    state.keys[event.code] = true;
  });
  document.addEventListener("keyup", (event) => {
    state.keys[event.code] = false;
  });

  canvas.addEventListener("mousemove", (event) => {
    const rect = canvas.getBoundingClientRect();
    state.mouse.x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    state.mouse.y = ((event.clientY - rect.top) / rect.height) * canvas.height;
  });
  canvas.addEventListener("mousedown", () => {
    state.mouse.down = true;
  });
  document.addEventListener("mouseup", () => {
    state.mouse.down = false;
  });

  updateHud();
  updateDifficultyVisibility();
  showOverlay("Maze Warface", "Enter your name and start the match.");
  requestAnimationFrame(frame);
})();
