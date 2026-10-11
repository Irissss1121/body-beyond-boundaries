const COLORS = {
  pink: [244, 94, 173],
  blue: [88, 172, 251],
  purple: [173, 118, 252],
};

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value) || 0));
const mix = (from, to, amount) => from + (to - from) * amount;

/** Abstract motion only: the camera image never enters this renderer. */
export function createVisuals(container, getState) {
  let observer;
  const instance = new window.p5((p) => {
    let stars = [];
    let particles = [];
    let activePreviously = false;
    let pinkEnergy = 0;
    let blueEnergy = 0;
    let sharedLevel = 0;
    let pinkY = 0.52;
    let blueY = 0.52;
    let clock = 0;

    const fit = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      if (width !== p.width || height !== p.height) p.resizeCanvas(width, height);
    };

    p.setup = () => {
      p.pixelDensity(Math.min(window.devicePixelRatio || 1, 1.5));
      const canvas = p.createCanvas(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
      canvas.elt.setAttribute('aria-hidden', 'true');
      canvas.elt.style.display = 'block';
      p.frameRate(30);
      p.noFill();
      // A fixed seed keeps the quiet field stable between frames.
      let seed = 173;
      const random = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };
      stars = Array.from({ length: 80 }, () => ({
        x: random(), y: random(), alpha: 14 + random() * 40,
        size: 0.45 + random() * 0.8, phase: random() * Math.PI * 2,
      }));
      observer = new ResizeObserver(fit);
      observer.observe(container);
    };

    function glow(color, alpha, blur = 7, weight = 0.7) {
      p.stroke(...color, alpha);
      p.strokeWeight(weight);
      p.drawingContext.shadowColor = `rgba(${color.join(',')},${Math.min(1, alpha / 170)})`;
      p.drawingContext.shadowBlur = blur;
    }

    function curve(points) {
      p.beginShape();
      for (const [x, y] of points) p.vertex(x, y);
      p.endShape();
    }

    function drawStars(time, active) {
      p.drawingContext.shadowBlur = 0;
      p.noStroke();
      for (const star of stars) {
        const alpha = star.alpha * (0.75 + 0.15 * Math.sin(time * 0.3 + star.phase));
        p.fill(169, 178, 212, alpha * (active ? 0.8 : 1));
        p.circle(star.x * p.width, star.y * p.height, star.size);
      }
      p.noFill();
    }

    function drawWelcome(time) {
      const cx = p.width * (p.width < 760 ? 0.67 : 0.70);
      const cy = p.height * 0.44;
      const scale = Math.min(p.width * 0.245, p.height * 0.32);
      const spin = time * 0.085;
      // Fine tilted orbits: two distinct colors share a transparent center.
      for (let side = 0; side < 2; side++) {
        const color = side === 0 ? COLORS.pink : COLORS.blue;
        const direction = side === 0 ? -1 : 1;
        for (let strand = 0; strand < 21; strand++) {
          const offset = strand / 20;
          const phase = spin + offset * 0.48 + side * 1.4;
          const points = [];
          for (let index = 0; index <= 132; index++) {
            const t = index / 132 * Math.PI * 2;
            const ripple = 1 + 0.09 * Math.sin(t * 3 + phase);
            const x = Math.cos(t + phase * 0.2) * scale * (0.79 + offset * 0.23) * ripple;
            const y = Math.sin(t * 2 + phase) * scale * 0.31 + Math.sin(t) * scale * 0.45;
            const z = Math.sin(t + phase) * scale * 0.27;
            points.push([
              cx + direction * scale * 0.29 + x * 0.75 + y * direction * 0.48,
              cy + y * 0.96 - x * direction * 0.18 + z * 0.28,
            ]);
          }
          glow(color, 22 + 34 * Math.sin(offset * Math.PI), 7, 0.65);
          curve(points);
        }
      }
      for (let strand = 0; strand < 8; strand++) {
        const points = [];
        for (let index = 0; index <= 110; index++) {
          const t = index / 110 * Math.PI * 2;
          const phase = spin + strand * 0.1;
          points.push([
            cx + Math.cos(t + phase) * scale * 0.51 + Math.sin(t * 3) * scale * 0.07,
            cy + Math.sin(t * 2 + phase) * scale * 0.48 + Math.sin(t) * scale * 0.15,
          ]);
        }
        glow(COLORS.purple, 25, 9, 0.65);
        curve(points);
      }
      p.drawingContext.shadowBlur = 0;
    }

    function drawIndividual(color, centerX, centerY, energy, time, sign) {
      const radius = Math.min(p.width * 0.10, p.height * 0.135);
      const count = 4 + Math.floor(energy * 15);
      for (let strand = 0; strand < count; strand++) {
        const offset = strand / Math.max(1, count - 1);
        const phase = time * (0.16 + energy * 0.3) * sign + strand * 0.19;
        const points = [];
        const radiusX = radius * (0.43 + offset * 0.59) * (0.85 + energy * 0.45);
        for (let index = 0; index <= 74; index++) {
          const t = index / 74 * Math.PI * 2;
          points.push([
            centerX + Math.cos(t + phase * 0.26) * radiusX + Math.sin(t * 3 + phase) * radius * 0.08 * energy,
            centerY + Math.sin(t * 2 + phase) * radius * 0.27 + Math.sin(t) * radius * 0.43 * (0.55 + offset * 0.65),
          ]);
        }
        glow(color, 16 + energy * (37 + offset * 58), 3 + energy * 6, 0.6 + energy * 0.25);
        curve(points);
      }
      // Tiny trailing signals stay close to their author's half of the space.
      if (energy > 0.1 && p.frameCount % 2 === 0 && particles.length < 170) {
        const phase = time * 2.4;
        particles.push({
          x: centerX + Math.cos(phase) * radius * 0.62,
          y: centerY + Math.sin(phase * 1.3) * radius * 0.30,
          vx: sign * (0.35 + energy * 1.25),
          vy: 0.15 + energy * 0.45,
          life: 1,
          color,
          seed: phase,
        });
      }
    }

    function drawParticles(delta) {
      for (const particle of particles) {
        particle.x += particle.vx * delta;
        particle.y += (particle.vy + Math.sin(clock * 1.4 + particle.seed) * 0.42) * delta;
        particle.life -= 0.012 * delta;
        glow(particle.color, particle.life * 70, 4, 0.8);
        p.line(particle.x, particle.y, particle.x - particle.vx * 7, particle.y - particle.vy * 7);
      }
      particles = particles.filter((particle) => particle.life > 0);
    }

    function drawShared(leftX, rightX, leftY, rightY, level, energy, time) {
      if (level < 0.008) return;
      const span = rightX - leftX;
      const breadth = Math.min(p.height * 0.21, p.width * 0.12) * (0.42 + level * 0.86);
      const count = 5 + Math.floor(level * 44);
      for (let strand = 0; strand < count; strand++) {
        const offset = strand / Math.max(1, count - 1);
        const phase = offset * Math.PI * 2 + time * (0.32 + energy * 0.22);
        const points = [];
        for (let index = 0; index <= 95; index++) {
          const u = index / 95;
          const envelope = Math.pow(Math.sin(u * Math.PI), 0.78);
          const wave = Math.sin(u * Math.PI * 3.1 + phase);
          points.push([
            leftX + u * span + Math.sin(u * Math.PI * 2 + phase) * breadth * 0.17 * envelope,
            mix(leftY, rightY, u) + wave * breadth * envelope * (0.3 + offset * 0.69)
              + Math.cos(u * Math.PI * 5 - phase * 0.7) * breadth * 0.13 * envelope,
          ]);
        }
        glow(COLORS.purple, level * (48 + 125 * Math.sin(offset * Math.PI)), 8 + level * 15, 0.75 + level * 0.4);
        curve(points);
      }
      // A second family closes into a living knot at the center of the bridge.
      for (let strand = 0; strand < Math.floor(level * 15); strand++) {
        const points = [];
        const phase = time * 0.21 + strand * 0.055;
        const r = breadth * (0.62 + strand * 0.031);
        for (let index = 0; index <= 90; index++) {
          const t = index / 90 * Math.PI * 2;
          points.push([
            (leftX + rightX) * 0.5 + Math.cos(t) * r * 0.84 + Math.cos(t * 3 + phase) * r * 0.17,
            (leftY + rightY) * 0.5 + Math.sin(t * 2 + phase) * r * 0.55 + Math.sin(t) * r * 0.17,
          ]);
        }
        glow(COLORS.purple, level * 92, 16, 0.85);
        curve(points);
      }
    }

    p.draw = () => {
      const state = getState() || {};
      const active = !!state.active;
      const delta = Math.min(2, Math.max(0.2, p.deltaTime / (1000 / 30)));
      clock += Math.min(0.08, p.deltaTime / 1000);
      p.blendMode(p.BLEND);
      p.background(8, 9, 16);
      p.push();
      p.drawingContext.save();
      p.blendMode(p.ADD);
      drawStars(clock, active);
      if (!active) {
        drawWelcome(clock);
      } else {
        if (!activePreviously) {
          particles = [];
          pinkEnergy = blueEnergy = sharedLevel = 0;
        }
        const a = (state.role === 'B' ? state.remote : state.local) || {};
        const b = (state.role === 'B' ? state.local : state.remote) || {};
        const smoothing = 1 - Math.pow(0.89, delta);
        pinkEnergy = mix(pinkEnergy, Math.max(clamp(a.energy), a.waving ? 0.25 : 0), smoothing);
        blueEnergy = mix(blueEnergy, Math.max(clamp(b.energy), b.waving ? 0.25 : 0), smoothing);
        const target = state.presence?.connected
          ? Math.max(0.55, clamp(state.presence?.level))
          : clamp(state.presence?.level);
        sharedLevel = mix(sharedLevel, target, 1 - Math.pow(0.90, delta));
        const handHeight = (person) => 0.43 + clamp(person.handY ?? 0.5) * 0.23;
        pinkY = mix(pinkY, handHeight(a), smoothing * 0.55);
        blueY = mix(blueY, handHeight(b), smoothing * 0.55);
        const leftX = p.width * 0.29;
        const rightX = p.width * 0.71;
        const leftY = p.height * pinkY;
        const rightY = p.height * blueY;
        drawIndividual(COLORS.pink, leftX, leftY, pinkEnergy, clock, 1);
        drawIndividual(COLORS.blue, rightX, rightY, blueEnergy, clock + 2.6, -1);
        drawShared(leftX, rightX, leftY, rightY, sharedLevel, (pinkEnergy + blueEnergy) / 2, clock);
        drawParticles(delta);
      }
      activePreviously = active;
      p.drawingContext.shadowBlur = 0;
      p.drawingContext.restore();
      p.pop();
      p.blendMode(p.BLEND);
    };
  }, container);

  const remove = instance.remove.bind(instance);
  instance.remove = () => {
    observer?.disconnect();
    remove();
  };
  return instance;
}
