# Prompt for generating a house layout and panoramas

Paste the block below into an image-capable model. What it returns goes into
`app/tour/projects/<id>/source/`, laid out as described at the end of this file.

```text
I am building an interactive 360 walkthrough of a single-family house. Generate a
consistent house and give me exactly these deliverables.

1. Style brief (one paragraph): architectural style, floor material, wall colour,
   trim, window frames, lighting time of day. Reuse it verbatim for every image.

2. Floor plan image: strictly top-down, orthographic, white background, black walls,
   room names printed inside rooms, a scale bar in metres, and a north arrow pointing
   to the TOP of the image. One floor, rectilinear rooms only, 6 to 10 rooms, about
   18 m by 12 m overall. Doorways drawn as gaps in walls.

3. Room table (JSON) matching the plan exactly:
   [{ "id": "r1", "name": "Kitchen", "type": "kitchen",
      "rect": { "minX": 2, "minY": -6, "maxX": 9, "maxY": -1 },
      "notes": "island seating for four, gas range" }]
   Metres, origin at the plan centre, +X to the right (east), +Y to the top (north).
   Rooms that share a wall must use identical edge coordinates. type is one of:
   entry, living, dining, kitchen, hallway, office, bedroom, bathroom, laundry,
   garage, other.

4. Viewpoint list (JSON): 1 viewpoint per small room, 2 to 3 in rooms longer than
   5 m, and 1 in each hallway segment. Each viewpoint gets an id (v1, v2...), the
   room id, and an X,Y position in metres, at least 0.8 m from any wall and at
   least 2 m from other viewpoints.

5. One panorama per viewpoint:
   - Equirectangular 360x180, exactly 2:1, at least 4096x2048, no fisheye
     or tiny-planet look.
   - Camera 1.5 m above the floor, level, at that viewpoint's exact X,Y position.
   - The CENTRE of the image faces NORTH (the top of the floor plan). The left and
     right edges meet facing south; put a plain wall there.
   - What is visible must match the plan: doorways where the plan has doorways,
     windows only on exterior walls, neighbouring rooms seen through open doors.
   - Viewpoints in the same room must show the SAME furniture in the same places,
     seen from their different positions.
   - Name each file <viewpointId>.jpg.

6. Two exterior stills (16:9, photoreal, same style): front elevation at eye level,
   and a rear or garden view. These are style references only; the video's
   exterior shots are rendered from the real cropped 3D model.

Return the style brief, the two JSON blocks, then the images, labelled by filename.
```

## Where the results go

```
app/tour/projects/<id>/source/
  style.txt            the style brief, plain text
  rooms.json           deliverable 3, as returned
  viewpoints.json      deliverable 4, as returned
  floorplan.png        deliverable 2 (.jpg is fine too)
  panos/v1.jpg ...     deliverable 5, one per viewpoint id
  exterior/front.jpg   deliverable 6
  exterior/rear.jpg
```

Image models often break the 2:1 seam, or furniture consistency between viewpoints
in one room. If they do, keep one viewpoint for that room and delete the others
from `viewpoints.json`.
