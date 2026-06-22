(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const overlayBtn = document.getElementById("overlay-btn");
  const healthEl = document.getElementById("health");
  const scoreEl = document.getElementById("score");
  const levelEl = document.getElementById("level");
  const powerupEl = document.getElementById("powerup");

  const mazeCols = 18;
  const mazeRows = 12;
  const cellSize = 50;
  const maxLevel = 5;
  const powerupSpawnChance = 0.65;
  const maxDeltaTime = 0.033;

  const state = {
    running: false,
    won: false,
    gameOver: false,
    level: 1,
    score: 0,
    keys: {},
    mouse: { x: canvas.width / 2, y: canvas.height / 2, down: false },
    walls: [],
    player: null,
    enemies: [],
    bullets: [],
    powerups: [],
    activePowerup: { type: null, timer: 0 },
    flashTimer: 0,
  };

  const rand = (min, max) => Math.random() * (max - min) + min;

  function generateMaze() {
    const grid = Array.from({ length: mazeRows }, () =>
      Array.from({ length: mazeCols }, () => ({ visited: false, walls: [1, 1, 1, 1] }))
    );
    const stack = [[0, 0]];
    grid[0][0].visited = true;
    const dirs = [
      [0, -1, 0, 2],
      [1, 0, 1, 3],
      [0, 1, 2, 0],
      [-1, 0, 3, 1],
    ];

    while (stack.length) {
      const [cx, cy] = stack[stack.length - 1];
      const neighbors = dirs
        .map(([dx, dy, from, to]) => ({ nx: cx + dx, ny: cy + dy, from, to }))
        .filter(({ nx, ny }) => nx >= 0 && ny >= 0 && nx < mazeCols && ny < mazeRows && !grid[ny][nx].visited);

      if (!neighbors.length) {
        stack.pop();
        continue;
      }

      const next = neighbors[(Math.random() * neighbors.length) | 0];
      grid[cy][cx].walls[next.from] = 0;
      grid[next.ny][next.nx].walls[next.to] = 0;
      grid[next.ny][next.nx].visited = true;
      stack.push([next.nx, next.ny]);
    }

    const walls = [];
    for (let y = 0; y < mazeRows; y++) {
      for (let x = 0; x < mazeCols; x++) {
        const c = grid[y][x];
        const px = x * cellSize;
        const py = y * cellSize;
        const t = 6;
        if (c.walls[0]) walls.push({ x: px, y: py, w: cellSize, h: t });
        if (c.walls[1]) walls.push({ x: px + cellSize - t, y: py, w: t, h: cellSize });
        if (c.walls[2]) walls.push({ x: px, y: py + cellSize - t, w: cellSize, h: t });
        if (c.walls[3]) walls.push({ x: px, y: py, w: t, h: cellSize });
      }
    }
    return walls;
  }

  function intersectsRectCircle(rect, x, y, r) {
    const nx = Math.max(rect.x, Math.min(x, rect.x + rect.w));
    const ny = Math.max(rect.y, Math.min(y, rect.y + rect.h));
    const dx = x - nx;
    const dy = y - ny;
    return dx * dx + dy * dy < r * r;
  }

  function lineOfSight(a, b) {
    const steps = 20;
    for (let i = 1; i < steps; i++) {
      const x = a.x + (b.x - a.x) * (i / steps);
      const y = a.y + (b.y - a.y) * (i / steps);
      if (state.walls.some((w) => intersectsRectCircle(w, x, y, 2))) return false;
    }
    return true;
  }

  function spawnTank(x, y, isEnemy = false) {
    return {
      x,
      y,
      r: 14,
      speed: isEnemy ? 95 + state.level * 8 : 135,
      angle: 0,
      hp: isEnemy ? 30 + state.level * 8 : 100,
      shootCd: 0,
      patrolTarget: { x, y },
    };
  }

  function validSpawn(x, y, radius = 14) {
    return !state.walls.some((w) => intersectsRectCircle(w, x, y, radius + 6));
  }

  function randomSpawn() {
    for (let i = 0; i < 1000; i++) {
      const x = rand(30, canvas.width - 30);
      const y = rand(30, canvas.height - 30);
      if (validSpawn(x, y)) return { x, y };
    }
    return { x: 40, y: 40 };
  }

  function setupLevel(level) {
    state.walls = generateMaze();
    const p = randomSpawn();
    state.player = spawnTank(p.x, p.y, false);
    state.player.hp = Math.min(100, state.player.hp + (level > 1 ? 20 : 0));
    state.bullets = [];
    state.powerups = [];
    state.activePowerup = { type: null, timer: 0 };

    const enemyCount = Math.min(2 + level, 8);
    state.enemies = Array.from({ length: enemyCount }, () => {
      let e;
      do {
        const s = randomSpawn();
        e = spawnTank(s.x, s.y, true);
      } while (Math.hypot(e.x - state.player.x, e.y - state.player.y) < 150);
      return e;
    });

    if (Math.random() < powerupSpawnChance) {
      const pu = randomSpawn();
      const types = ["rapid fire", "shield", "speed boost"];
      state.powerups.push({ ...pu, r: 10, type: types[(Math.random() * types.length) | 0] });
    }

    levelEl.textContent = `Level: ${state.level}`;
  }

  function shoot(shooter, targetX, targetY, enemyShot = false) {
    if (shooter.shootCd > 0) return;
    const angle = Math.atan2(targetY - shooter.y, targetX - shooter.x);
    const speed = enemyShot ? 210 : 260;
    state.bullets.push({
      x: shooter.x,
      y: shooter.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      ownerEnemy: enemyShot,
      bounces: 2,
      life: 3.2,
      r: 4,
    });
    const fireRate = !enemyShot && state.activePowerup.type === "rapid fire" ? 0.12 : enemyShot ? 0.9 : 0.28;
    shooter.shootCd = fireRate;
  }

  function moveTank(tank, dt, moveX, moveY) {
    const len = Math.hypot(moveX, moveY) || 1;
    const vx = (moveX / len) * tank.speed * dt;
    const vy = (moveY / len) * tank.speed * dt;
    const nx = tank.x + vx;
    const ny = tank.y + vy;

    if (!state.walls.some((w) => intersectsRectCircle(w, nx, tank.y, tank.r))) tank.x = nx;
    if (!state.walls.some((w) => intersectsRectCircle(w, tank.x, ny, tank.r))) tank.y = ny;

    tank.x = Math.max(tank.r, Math.min(canvas.width - tank.r, tank.x));
    tank.y = Math.max(tank.r, Math.min(canvas.height - tank.r, tank.y));
  }

  function updatePlayer(dt) {
    const player = state.player;
    if (!player) return;

    let mx = 0;
    let my = 0;
    if (state.keys.KeyW) my -= 1;
    if (state.keys.KeyS) my += 1;
    if (state.keys.KeyA) mx -= 1;
    if (state.keys.KeyD) mx += 1;

    const speedMul = state.activePowerup.type === "speed boost" ? 1.45 : 1;
    const oldSpeed = player.speed;
    player.speed = 135 * speedMul;
    moveTank(player, dt, mx, my);
    player.speed = oldSpeed;

    player.angle = Math.atan2(state.mouse.y - player.y, state.mouse.x - player.x);
    if (state.mouse.down) shoot(player, state.mouse.x, state.mouse.y, false);
  }

  function updateEnemies(dt) {
    const player = state.player;
    state.enemies.forEach((enemy) => {
      const seesPlayer = lineOfSight(enemy, player);
      let tx = enemy.patrolTarget.x;
      let ty = enemy.patrolTarget.y;

      if (seesPlayer) {
        tx = player.x;
        ty = player.y;
        if (Math.hypot(player.x - enemy.x, player.y - enemy.y) < 360) {
          shoot(enemy, player.x, player.y, true);
        }
      } else if (Math.hypot(tx - enemy.x, ty - enemy.y) < 12) {
        enemy.patrolTarget = randomSpawn();
      }

      enemy.angle = Math.atan2(ty - enemy.y, tx - enemy.x);
      moveTank(enemy, dt, Math.cos(enemy.angle), Math.sin(enemy.angle));
    });
  }

  function updateBullets(dt) {
    for (const b of state.bullets) {
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      if (b.x <= 0 || b.x >= canvas.width) {
        b.vx *= -1;
        b.bounces -= 1;
        b.x = Math.max(1, Math.min(canvas.width - 1, b.x));
      }
      if (b.y <= 0 || b.y >= canvas.height) {
        b.vy *= -1;
        b.bounces -= 1;
        b.y = Math.max(1, Math.min(canvas.height - 1, b.y));
      }

      for (const w of state.walls) {
        if (!intersectsRectCircle(w, b.x, b.y, b.r)) continue;
        const cx = w.x + w.w / 2;
        const cy = w.y + w.h / 2;
        const dx = b.x - cx;
        const dy = b.y - cy;
        if (Math.abs(dx / (w.w || 1)) > Math.abs(dy / (w.h || 1))) b.vx *= -1;
        else b.vy *= -1;
        b.bounces -= 1;
        break;
      }

      if (!b.ownerEnemy) {
        for (const e of state.enemies) {
          if (Math.hypot(b.x - e.x, b.y - e.y) < e.r + b.r) {
            e.hp -= 25;
            b.life = 0;
            if (e.hp <= 0) state.score += 100;
            break;
          }
        }
      } else {
        const p = state.player;
        if (Math.hypot(b.x - p.x, b.y - p.y) < p.r + b.r) {
          const protectedByShield = state.activePowerup.type === "shield";
          if (!protectedByShield) {
            p.hp -= 14;
            state.flashTimer = 0.08;
          }
          b.life = 0;
        }
      }
    }

    state.enemies = state.enemies.filter((e) => e.hp > 0);
    state.bullets = state.bullets.filter((b) => b.life > 0 && b.bounces >= 0);
  }

  function updatePowerups(dt) {
    const p = state.player;
    state.powerups = state.powerups.filter((pu) => {
      if (Math.hypot(p.x - pu.x, p.y - pu.y) < p.r + pu.r) {
        state.activePowerup = { type: pu.type, timer: 9 };
        return false;
      }
      return true;
    });

    if (state.activePowerup.timer > 0) {
      state.activePowerup.timer -= dt;
      if (state.activePowerup.timer <= 0) state.activePowerup = { type: null, timer: 0 };
    }
  }

  function drawTank(tank, color, barrel = "#d6dcf5") {
    if (!tank) return;
    ctx.save();
    ctx.translate(tank.x, tank.y);
    ctx.rotate(tank.angle);
    ctx.fillStyle = color;
    ctx.fillRect(-tank.r, -tank.r, tank.r * 2, tank.r * 2);
    ctx.fillStyle = barrel;
    ctx.fillRect(0, -3, tank.r + 10, 6);
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#090f1f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const w of state.walls) {
      ctx.fillStyle = "#2a2f44";
      ctx.fillRect(w.x, w.y, w.w, w.h);
    }

    for (const pu of state.powerups) {
      ctx.fillStyle = pu.type === "shield" ? "#44b4ff" : pu.type === "rapid fire" ? "#ffc64d" : "#73ff9f";
      ctx.beginPath();
      ctx.arc(pu.x, pu.y, pu.r, 0, Math.PI * 2);
      ctx.fill();
    }

    drawTank(state.player, "#39ff8a");
    for (const e of state.enemies) drawTank(e, "#ff4f6d");

    for (const b of state.bullets) {
      ctx.fillStyle = b.ownerEnemy ? "#ff8ba1" : "#d8ff7a";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (state.flashTimer > 0) {
      ctx.fillStyle = "rgba(255, 79, 109, 0.2)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  function updateHud() {
    healthEl.textContent = `Health: ${Math.max(0, Math.ceil(state.player.hp))}`;
    scoreEl.textContent = `Score: ${state.score}`;
    levelEl.textContent = `Level: ${state.level}`;
    const active = state.activePowerup.type
      ? `${state.activePowerup.type} (${Math.ceil(state.activePowerup.timer)}s)`
      : "None";
    powerupEl.textContent = `Power-up: ${active}`;
  }

  function showOverlay(title, text, buttonText) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlayBtn.textContent = buttonText;
    overlay.classList.add("visible");
  }

  function hideOverlay() {
    overlay.classList.remove("visible");
  }

  function endGame(victory = false) {
    state.running = false;
    state.gameOver = !victory;
    state.won = victory;
    if (victory) showOverlay("Victory!", `Final score: ${state.score}`, "Play Again");
    else showOverlay("Game Over", `Final score: ${state.score}`, "Retry");
  }

  function nextLevel() {
    if (state.level >= maxLevel) {
      endGame(true);
      return;
    }
    state.level += 1;
    setupLevel(state.level);
  }

  function resetGame() {
    state.level = 1;
    state.score = 0;
    state.gameOver = false;
    state.won = false;
    setupLevel(1);
    state.running = true;
    hideOverlay();
  }

  let last = performance.now();
  function tick(now) {
    const dt = Math.min(maxDeltaTime, (now - last) / 1000);
    last = now;

    if (state.running) {
      state.flashTimer = Math.max(0, state.flashTimer - dt);
      state.player.shootCd = Math.max(0, state.player.shootCd - dt);
      state.enemies.forEach((e) => (e.shootCd = Math.max(0, e.shootCd - dt)));

      updatePlayer(dt);
      updateEnemies(dt);
      updateBullets(dt);
      updatePowerups(dt);

      if (state.player.hp <= 0) endGame(false);
      if (state.enemies.length === 0 && state.running) nextLevel();

      updateHud();
    }

    draw();
    requestAnimationFrame(tick);
  }

  overlayBtn.addEventListener("click", resetGame);

  document.addEventListener("keydown", (e) => {
    state.keys[e.code] = true;
  });
  document.addEventListener("keyup", (e) => {
    state.keys[e.code] = false;
  });

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    state.mouse.x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    state.mouse.y = ((e.clientY - rect.top) / rect.height) * canvas.height;
  });
  canvas.addEventListener("mousedown", () => {
    state.mouse.down = true;
  });
  document.addEventListener("mouseup", () => {
    state.mouse.down = false;
  });

  showOverlay("Maze Warfare", "Clear five random mazes and survive enemy tanks.", "Start Game");
  requestAnimationFrame(tick);
})();
