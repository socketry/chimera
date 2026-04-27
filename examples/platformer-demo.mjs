import {Application} from "@socketry/htty";

Application.open(() => ({
	status: 200,
	headers: {"content-type": "text/html; charset=utf-8"},
	body: `<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>HTTY Platformer</title>
		<style>
			:root {
				color-scheme: dark;
				font-family: "Avenir Next", "Helvetica Neue", sans-serif;
			}
			
			html,
			body {
				margin: 0;
				width: 100%;
				height: 100%;
				overflow: hidden;
				background: #07111f;
				color: #eef6ff;
			}
			
			canvas {
				display: block;
				width: 100vw;
				height: 100vh;
				background:
					radial-gradient(circle at 20% 20%, rgba(125, 211, 252, 0.25), transparent 22%),
					linear-gradient(180deg, #10233f 0%, #07111f 58%, #050914 100%);
			}
			
			.hud {
				position: fixed;
				inset: 18px 18px auto;
				display: flex;
				justify-content: space-between;
				gap: 16px;
				pointer-events: none;
				font-size: 14px;
				font-weight: 650;
				text-shadow: 0 2px 12px rgba(0, 0, 0, 0.55);
			}
			
			.badge {
				padding: 8px 11px;
				border: 1px solid rgba(255, 255, 255, 0.14);
				border-radius: 999px;
				background: rgba(5, 11, 21, 0.46);
				backdrop-filter: blur(12px);
			}
		</style>
	</head>
	<body>
		<canvas id="game" aria-label="HTTY platformer game"></canvas>
		<div class="hud">
			<div class="badge">Move: A/D or Arrow Keys · Jump: Space/W/↑</div>
			<div class="badge" id="score">Stars 0/0</div>
		</div>
		<script>
			const canvas = document.getElementById("game");
			const context = canvas.getContext("2d");
			const scoreNode = document.getElementById("score");
			const keys = new Set();
			
			const world = {
				width: 2200,
				height: 900,
				gravity: 2100,
				cameraX: 0,
			};
			
			const player = {
				x: 90,
				y: 560,
				width: 34,
				height: 44,
				vx: 0,
				vy: 0,
				onGround: false,
				stars: 0,
			};
			
			const platforms = [
				{x: 0, y: 740, width: 520, height: 46},
				{x: 610, y: 650, width: 250, height: 34},
				{x: 940, y: 565, width: 240, height: 34},
				{x: 1240, y: 680, width: 280, height: 34},
				{x: 1580, y: 585, width: 260, height: 34},
				{x: 1900, y: 720, width: 300, height: 46},
			];
			
			const stars = [
				{x: 690, y: 600, taken: false},
				{x: 1030, y: 515, taken: false},
				{x: 1370, y: 630, taken: false},
				{x: 1700, y: 535, taken: false},
				{x: 2030, y: 670, taken: false},
			];
			
			function resize() {
				const scale = window.devicePixelRatio || 1;
				canvas.width = Math.floor(window.innerWidth * scale);
				canvas.height = Math.floor(window.innerHeight * scale);
				context.setTransform(scale, 0, 0, scale, 0, 0);
			}
			
			function pressed(...names) {
				return names.some((name) => keys.has(name));
			}
			
			function intersects(a, b) {
				return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
			}
			
			function update(delta) {
				const speed = 430;
				const jump = 760;
				
				player.vx = 0;
				if (pressed("ArrowLeft", "a", "A")) player.vx -= speed;
				if (pressed("ArrowRight", "d", "D")) player.vx += speed;
				if (player.onGround && pressed(" ", "ArrowUp", "w", "W")) {
					player.vy = -jump;
					player.onGround = false;
				}
				
				player.vy += world.gravity * delta;
				player.x += player.vx * delta;
				player.y += player.vy * delta;
				player.x = Math.max(0, Math.min(world.width - player.width, player.x));
				
				player.onGround = false;
				for (const platform of platforms) {
					if (intersects(player, platform) && player.vy >= 0 && player.y + player.height - player.vy * delta <= platform.y + 10) {
						player.y = platform.y - player.height;
						player.vy = 0;
						player.onGround = true;
					}
				}
				
				if (player.y > world.height) {
					player.x = 90;
					player.y = 560;
					player.vx = 0;
					player.vy = 0;
				}
				
				for (const star of stars) {
					if (!star.taken) {
						const dx = player.x + player.width / 2 - star.x;
						const dy = player.y + player.height / 2 - star.y;
						if (Math.hypot(dx, dy) < 42) {
							star.taken = true;
							player.stars += 1;
						}
					}
				}
				
				const viewportWidth = window.innerWidth;
				world.cameraX += ((player.x + player.width / 2) - viewportWidth * 0.42 - world.cameraX) * Math.min(1, delta * 7);
				world.cameraX = Math.max(0, Math.min(world.width - viewportWidth, world.cameraX));
				scoreNode.textContent = "Stars " + player.stars + "/" + stars.length;
			}
			
			function drawStar(x, y, radius) {
				context.beginPath();
				for (let i = 0; i < 10; i += 1) {
					const angle = -Math.PI / 2 + i * Math.PI / 5;
					const length = i % 2 === 0 ? radius : radius * 0.45;
					context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
				}
				context.closePath();
				context.fill();
			}
			
			function render() {
				const width = window.innerWidth;
				const height = window.innerHeight;
				context.clearRect(0, 0, width, height);
				
				context.save();
				context.translate(-world.cameraX, 0);
				
				for (let i = 0; i < 70; i += 1) {
					const x = (i * 173) % world.width;
					const y = 80 + (i * 79) % 250;
					context.fillStyle = "rgba(255, 255, 255, 0.32)";
					context.fillRect(x, y, 2, 2);
				}
				
				for (const platform of platforms) {
					const gradient = context.createLinearGradient(0, platform.y, 0, platform.y + platform.height);
					gradient.addColorStop(0, "#7dd3fc");
					gradient.addColorStop(1, "#2563eb");
					context.fillStyle = gradient;
					context.fillRect(platform.x, platform.y, platform.width, platform.height);
					context.fillStyle = "rgba(255, 255, 255, 0.28)";
					context.fillRect(platform.x, platform.y, platform.width, 4);
				}
				
				context.fillStyle = "#facc15";
				for (const star of stars) {
					if (!star.taken) drawStar(star.x, star.y, 18);
				}
				
				context.fillStyle = "#fb7185";
				context.fillRect(player.x, player.y, player.width, player.height);
				context.fillStyle = "#ffffff";
				context.fillRect(player.x + 8, player.y + 10, 6, 6);
				context.fillRect(player.x + 21, player.y + 10, 6, 6);
				context.fillStyle = "#111827";
				context.fillRect(player.x + 9, player.y + 12, 3, 3);
				context.fillRect(player.x + 22, player.y + 12, 3, 3);
				
				context.restore();
				
				if (player.stars === stars.length) {
					context.fillStyle = "rgba(5, 11, 21, 0.62)";
					context.fillRect(0, 0, width, height);
					context.fillStyle = "#ffffff";
					context.font = "700 42px Avenir Next, sans-serif";
					context.textAlign = "center";
					context.fillText("You collected every HTTY star!", width / 2, height / 2);
					context.font = "500 18px Avenir Next, sans-serif";
					context.fillText("Reload the page to play again.", width / 2, height / 2 + 38);
				}
			}
			
			let previous = performance.now();
			function tick(now) {
				const delta = Math.min(0.033, (now - previous) / 1000);
				previous = now;
				update(delta);
				render();
				requestAnimationFrame(tick);
			}
			
			window.addEventListener("resize", resize);
			window.addEventListener("keydown", (event) => {
				keys.add(event.key);
				if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) event.preventDefault();
			});
			window.addEventListener("keyup", (event) => keys.delete(event.key));
			
			resize();
			requestAnimationFrame(tick);
		</script>
	</body>
</html>`,
}));
