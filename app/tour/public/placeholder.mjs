/**
 * A procedural stand-in panorama, drawn when a room has no generated image yet.
 *
 * It is also the calibration tool for the heading convention. The compass ticks
 * are placed from the same formula the camera uses, so if a move to heading 90
 * does not land on the tick labelled 90, something disagrees about which way is
 * which. See CONTRACT.md.
 */

const WIDTH = 2048;
const HEIGHT = 1024;

/** Ceiling and floor tints, chosen only to make rooms distinguishable. */
const PALETTE = {
  entry: ["#3b4256", "#232735"],
  living: ["#4a3f33", "#2b241c"],
  kitchen: ["#33454a", "#1d2a2e"],
  dining: ["#45353f", "#271d24"],
  hallway: ["#3a3a42", "#232329"],
  office: ["#36414d", "#1f262e"],
  bedroom: ["#463a47", "#282029"],
  bathroom: ["#2f4550", "#1b2a31"],
  laundry: ["#3d4038", "#232519"],
  garage: ["#33373b", "#1e2124"],
  basement: ["#2e2e33", "#1a1a1e"],
  other: ["#3a3a3a", "#212121"]
};

/** The centre column faces heading 0, so the seam sits behind you at 180. */
export function headingToX(heading) {
  return (((heading - 180) % 360 + 360) % 360 / 360) * WIDTH;
}

function verticalBand(context, x, color, width) {
  context.fillStyle = color;
  context.fillRect(x - width / 2, 0, width, HEIGHT);
}

export function placeholderPanorama(room, targets = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  const [ceiling, floor] = PALETTE[room?.type] ?? PALETTE.other;

  const above = context.createLinearGradient(0, 0, 0, HEIGHT / 2);
  above.addColorStop(0, "#0d0f13");
  above.addColorStop(1, ceiling);
  context.fillStyle = above;
  context.fillRect(0, 0, WIDTH, HEIGHT / 2);

  const below = context.createLinearGradient(0, HEIGHT / 2, 0, HEIGHT);
  below.addColorStop(0, floor);
  below.addColorStop(1, "#08090b");
  context.fillStyle = below;
  context.fillRect(0, HEIGHT / 2, WIDTH, HEIGHT / 2);

  for (const [name, target] of Object.entries(targets)) {
    if (target?.heading == null) continue;
    const x = headingToX(target.heading);
    if (target.kind === "windows") verticalBand(context, x, "rgba(255, 238, 190, 0.20)", 190);
    if (target.kind === "door") verticalBand(context, x, "rgba(120, 190, 255, 0.16)", 96);

    context.fillStyle = target.kind === "windows" ? "#ffe9b0" : "#8fc7ff";
    context.font = "600 26px ui-sans-serif, system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText(name.toUpperCase(), x, HEIGHT / 2 + 150);
  }

  context.strokeStyle = "rgba(255, 255, 255, 0.28)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, HEIGHT / 2);
  context.lineTo(WIDTH, HEIGHT / 2);
  context.stroke();

  for (let heading = 0; heading < 360; heading += 30) {
    const x = headingToX(heading);
    const major = heading % 90 === 0;
    context.strokeStyle = major ? "rgba(255, 255, 255, 0.5)" : "rgba(255, 255, 255, 0.22)";
    context.lineWidth = major ? 3 : 1;
    context.beginPath();
    context.moveTo(x, HEIGHT / 2 - (major ? 46 : 26));
    context.lineTo(x, HEIGHT / 2 + (major ? 46 : 26));
    context.stroke();

    context.fillStyle = major ? "#ffffff" : "rgba(255, 255, 255, 0.55)";
    context.font = `${major ? "700 34px" : "500 24px"} ui-sans-serif, system-ui, sans-serif`;
    context.textAlign = "center";
    context.fillText(String(heading), x, HEIGHT / 2 - 62);
  }

  const centre = headingToX(0);
  context.textAlign = "center";
  context.fillStyle = "#ffffff";
  context.font = "700 76px ui-sans-serif, system-ui, sans-serif";
  context.fillText(room?.name ?? "Room", centre, HEIGHT / 2 + 240);

  context.fillStyle = "rgba(255, 255, 255, 0.6)";
  context.font = "500 34px ui-sans-serif, system-ui, sans-serif";
  const subtitle = [room?.type, room?.areaSqFt ? `${room.areaSqFt} sq ft` : null]
    .filter(Boolean)
    .join("  ·  ");
  context.fillText(subtitle, centre, HEIGHT / 2 + 296);

  context.fillStyle = "rgba(255, 255, 255, 0.34)";
  context.font = "500 26px ui-sans-serif, system-ui, sans-serif";
  context.fillText("placeholder panorama — numbers are headings", centre, HEIGHT / 2 + 352);

  return canvas;
}
