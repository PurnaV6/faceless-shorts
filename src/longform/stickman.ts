import type { SKRSContext2D } from "@napi-rs/canvas";

export const POSES = [
  "stand",
  "walk",
  "run",
  "scared",
  "point",
  "sit",
  "crouch",
  "lie",
  "reach",
  "look_back",
  "hide_face",
] as const;
export type Pose = (typeof POSES)[number];
export type FigureKind = "stickman" | "shadow";
export type Prop = "flashlight" | "phone" | "lantern" | "bag";

// Joint angles in degrees. Limb angles are measured from straight down,
// positive toward the direction the figure faces; forearm and shin angles
// are relative to the upper limb. lean tilts the torso forward.
export interface PoseAngles {
  lean: number;
  headTilt: number;
  backArm: [number, number];
  frontArm: [number, number];
  backLeg: [number, number];
  frontLeg: [number, number];
  // Hip height as a fraction of a standing figure's leg length.
  hipLift: number;
  // Extra vertical offset in body units (walk bob, breathing).
  bob: number;
  // Whole-body rotation in degrees around the hip (lying down).
  roll: number;
  // Eyes on the back of the head (looking behind).
  lookBack: boolean;
}

const SIN = (deg: number) => Math.sin((deg * Math.PI) / 180);
const COS = (deg: number) => Math.cos((deg * Math.PI) / 180);

function base(): PoseAngles {
  return {
    lean: 0,
    headTilt: 0,
    backArm: [-6, 6],
    frontArm: [6, 6],
    backLeg: [-4, 0],
    frontLeg: [4, 0],
    hipLift: 1,
    bob: 0,
    roll: 0,
    lookBack: false,
  };
}

// Small deterministic tremble so scared figures shake without randomness.
function tremble(t: number, amount: number): number {
  return amount * (Math.sin(t * 47) * 0.6 + Math.sin(t * 31 + 1.3) * 0.4);
}

export function poseAt(pose: Pose, t: number, speed = 1): PoseAngles {
  const p = base();
  const breath = Math.sin(t * 2.2) * 1.2;
  switch (pose) {
    case "stand": {
      p.bob = breath * 0.5;
      p.headTilt = Math.sin(t * 0.7) * 3;
      return p;
    }
    case "walk":
    case "run": {
      const running = pose === "run";
      const phase = t * Math.PI * 2 * (running ? 2.4 : 1.5) * speed;
      const stride = running ? 42 : 24;
      const s = Math.sin(phase);
      p.frontLeg = [stride * s, -Math.max(0, -Math.cos(phase)) * (running ? 70 : 35)];
      p.backLeg = [-stride * s, -Math.max(0, Math.cos(phase)) * (running ? 70 : 35)];
      p.frontArm = [-stride * 0.8 * s, running ? 75 : 15];
      p.backArm = [stride * 0.8 * s, running ? 75 : 15];
      p.lean = running ? 14 : 3;
      p.bob = Math.abs(Math.cos(phase)) * (running ? 6 : 3);
      return p;
    }
    case "scared": {
      p.lean = -8 + tremble(t, 1.5);
      p.frontArm = [120 + tremble(t, 4), 35];
      p.backArm = [95 + tremble(t, 4), 50];
      p.frontLeg = [14, -18];
      p.backLeg = [-10, -12];
      p.hipLift = 0.93;
      p.headTilt = -8 + tremble(t, 3);
      return p;
    }
    case "point": {
      p.frontArm = [88 + Math.sin(t * 1.5) * 2, 0];
      p.backArm = [-8, 10];
      p.lean = 4;
      p.bob = breath * 0.4;
      return p;
    }
    case "sit": {
      p.hipLift = 0.48;
      p.frontLeg = [88, -85];
      p.backLeg = [80, -80];
      p.frontArm = [35, -20];
      p.backArm = [25, -15];
      p.lean = 6 + breath;
      return p;
    }
    case "crouch": {
      p.hipLift = 0.58;
      p.frontLeg = [75, -125];
      p.backLeg = [55, -120];
      p.lean = 28;
      p.frontArm = [40, 20];
      p.backArm = [25, 25];
      p.headTilt = 12;
      return p;
    }
    case "lie": {
      p.roll = -90;
      p.hipLift = 0.12;
      p.frontArm = [8, 0];
      p.backArm = [-4, 0];
      p.bob = breath * 0.3;
      return p;
    }
    case "reach": {
      const r = (Math.sin(t * 0.9) + 1) / 2;
      p.frontArm = [80 + r * 30, -10];
      p.backArm = [10, 20];
      p.lean = 10 + r * 6;
      p.frontLeg = [18, -6];
      p.backLeg = [-14, -4];
      return p;
    }
    case "look_back": {
      p.lookBack = true;
      p.headTilt = -6;
      p.lean = -3;
      p.backArm = [-14, 10];
      p.frontArm = [4, 8];
      p.bob = breath * 0.4;
      return p;
    }
    case "hide_face": {
      p.hipLift = 0.82;
      p.lean = 18 + tremble(t, 1.2);
      p.frontArm = [150 + tremble(t, 3), 45];
      p.backArm = [140 + tremble(t, 3), 55];
      p.frontLeg = [28, -40];
      p.backLeg = [8, -34];
      p.headTilt = 20;
      return p;
    }
  }
}

export interface FigureDraw {
  kind: FigureKind;
  pose: Pose;
  x: number; // px, hip position
  groundY: number; // px
  scale: number;
  facing: 1 | -1;
  t: number; // seconds into the scene
  alpha: number;
  prop?: Prop;
  speed?: number;
}

// Body proportions in body units; 1 unit = 1px at scale 1 on a 1080p frame.
const BODY = {
  head: 24,
  torso: 92,
  upperArm: 50,
  foreArm: 46,
  thigh: 60,
  shin: 60,
  line: 9,
};

export function drawFigure(ctx: SKRSContext2D, f: FigureDraw): void {
  const shadow = f.kind === "shadow";
  const s = f.scale * (shadow ? 1.45 : 1);
  const a = poseAt(f.pose, f.t, f.speed ?? (shadow ? 0.6 : 1));
  const dir = f.facing;
  const legLen = (BODY.thigh + BODY.shin) * s;
  const hipY = f.groundY - legLen * a.hipLift - a.bob * s;

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, f.alpha));
  ctx.translate(f.x, hipY);
  if (a.roll) {
    // Rotate the body around the hip and drop it onto the ground line.
    ctx.translate(0, legLen * a.hipLift * 0.9);
    ctx.rotate(((a.roll * Math.PI) / 180) * dir * -1);
  }

  const limb = (
    ox: number,
    oy: number,
    angle: number,
    length: number,
  ): [number, number] => [ox + SIN(angle) * length * s * dir, oy + COS(angle) * length * s];

  const neck: [number, number] = [
    SIN(a.lean) * BODY.torso * s * dir,
    -COS(a.lean) * BODY.torso * s,
  ];
  const headAngle = a.lean + a.headTilt;
  const head: [number, number] = [
    neck[0] + SIN(headAngle) * (BODY.head + 6) * s * dir,
    neck[1] - COS(headAngle) * (BODY.head + 6) * s,
  ];
  const backElbow = limb(neck[0], neck[1], a.backArm[0], BODY.upperArm * (shadow ? 1.25 : 1));
  const backHand = limb(backElbow[0], backElbow[1], a.backArm[0] + a.backArm[1], BODY.foreArm * (shadow ? 1.35 : 1));
  const frontElbow = limb(neck[0], neck[1], a.frontArm[0], BODY.upperArm * (shadow ? 1.25 : 1));
  const frontHand = limb(frontElbow[0], frontElbow[1], a.frontArm[0] + a.frontArm[1], BODY.foreArm * (shadow ? 1.35 : 1));
  const backKnee = limb(0, 0, a.backLeg[0], BODY.thigh);
  const backFoot = limb(backKnee[0], backKnee[1], a.backLeg[0] + a.backLeg[1], BODY.shin);
  const frontKnee = limb(0, 0, a.frontLeg[0], BODY.thigh);
  const frontFoot = limb(frontKnee[0], frontKnee[1], a.frontLeg[0] + a.frontLeg[1], BODY.shin);

  const stroke = shadow ? "#040406" : "#f2f2ee";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = BODY.line * s * (shadow ? 0.8 : 1);
  if (shadow) {
    // A faint cold rim keeps a black figure readable on a dark scene.
    ctx.shadowColor = "rgba(150,160,190,0.35)";
    ctx.shadowBlur = 18 * s;
  } else {
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 10 * s;
  }

  if (f.prop === "flashlight") drawFlashlightBeam(ctx, frontHand, a.frontArm[0] + a.frontArm[1], s, dir);

  const segments: [number, number][][] = [
    [backElbow, backHand],
    [neck, backElbow],
    [[0, 0], backKnee],
    [backKnee, backFoot],
    [[0, 0], neck],
    [[0, 0], frontKnee],
    [frontKnee, frontFoot],
    [neck, frontElbow],
    [frontElbow, frontHand],
  ];
  ctx.strokeStyle = stroke;
  for (const [from, to] of segments) {
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(to[0], to[1]);
    ctx.stroke();
  }

  // Head
  ctx.beginPath();
  ctx.arc(head[0], head[1], BODY.head * s * (shadow ? 0.85 : 1), 0, Math.PI * 2);
  ctx.fillStyle = shadow ? "#040406" : "#f2f2ee";
  ctx.fill();
  ctx.shadowBlur = 0;

  // Eyes: dark dots for people, pale glowing points for the shadow.
  const eyeSide = a.lookBack ? -1 : 1;
  const eyeX = head[0] + BODY.head * 0.42 * s * dir * eyeSide;
  const eyeY = head[1] - BODY.head * 0.12 * s;
  const eyeR = (shadow ? 3.6 : f.pose === "scared" ? 4.2 : 3.2) * s;
  ctx.fillStyle = shadow ? "rgba(235,235,225,0.95)" : "#111";
  if (shadow) {
    ctx.shadowColor = "rgba(255,255,240,0.9)";
    ctx.shadowBlur = 14 * s;
  }
  for (const offset of [-7, 4]) {
    ctx.beginPath();
    ctx.arc(eyeX + offset * s * dir * eyeSide * 0.9, eyeY, eyeR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  if (f.prop && f.prop !== "flashlight") drawProp(ctx, f.prop, frontHand, s, dir, f.t);
  if (f.prop === "flashlight") {
    ctx.fillStyle = "#2a2a2a";
    ctx.fillRect(frontHand[0] - 6 * s, frontHand[1] - 5 * s, 18 * s * dir, 10 * s);
  }
  ctx.restore();
}

function drawFlashlightBeam(
  ctx: SKRSContext2D,
  hand: [number, number],
  armAngle: number,
  s: number,
  dir: 1 | -1,
): void {
  // Beam points along the forearm, widening into a soft cone.
  const len = 900 * s;
  const spread = 16;
  const a1 = armAngle - spread;
  const a2 = armAngle + spread;
  const p1: [number, number] = [hand[0] + SIN(a1) * len * dir, hand[1] + COS(a1) * len];
  const p2: [number, number] = [hand[0] + SIN(a2) * len * dir, hand[1] + COS(a2) * len];
  const gradient = ctx.createRadialGradient(hand[0], hand[1], 4, hand[0], hand[1], len);
  gradient.addColorStop(0, "rgba(255,246,210,0.55)");
  gradient.addColorStop(0.5, "rgba(255,246,210,0.14)");
  gradient.addColorStop(1, "rgba(255,246,210,0)");
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(hand[0], hand[1]);
  ctx.lineTo(p1[0], p1[1]);
  ctx.lineTo(p2[0], p2[1]);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawProp(
  ctx: SKRSContext2D,
  prop: Prop,
  hand: [number, number],
  s: number,
  dir: 1 | -1,
  t: number,
): void {
  ctx.save();
  if (prop === "phone") {
    const glow = ctx.createRadialGradient(hand[0], hand[1], 2, hand[0], hand[1], 70 * s);
    glow.addColorStop(0, "rgba(170,200,255,0.45)");
    glow.addColorStop(1, "rgba(170,200,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(hand[0] - 70 * s, hand[1] - 70 * s, 140 * s, 140 * s);
    ctx.fillStyle = "#cfe0ff";
    ctx.fillRect(hand[0] - 5 * s, hand[1] - 16 * s, 10 * s * dir, 22 * s);
  } else if (prop === "lantern") {
    const flicker = 0.85 + Math.sin(t * 9) * 0.08 + Math.sin(t * 23) * 0.05;
    const glow = ctx.createRadialGradient(hand[0], hand[1] + 20 * s, 2, hand[0], hand[1] + 20 * s, 220 * s);
    glow.addColorStop(0, `rgba(255,190,90,${0.55 * flicker})`);
    glow.addColorStop(1, "rgba(255,190,90,0)");
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = glow;
    ctx.fillRect(hand[0] - 220 * s, hand[1] - 200 * s, 440 * s, 440 * s);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#ffcf7a";
    ctx.fillRect(hand[0] - 9 * s, hand[1] + 10 * s, 18 * s, 22 * s);
  } else if (prop === "bag") {
    ctx.fillStyle = "#6b5a45";
    ctx.fillRect(hand[0] - 14 * s, hand[1], 28 * s, 30 * s);
  }
  ctx.restore();
}
