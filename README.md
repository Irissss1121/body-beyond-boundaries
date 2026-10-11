# The Body Is Not the Boundary of the Self

A small two-person installation made with p5.js, ml5 BodyPose, and p5LiveMedia.

## Join with a friend

Open the same GitHub Pages URL on two computers. One person chooses **A / PINK** and the other chooses **B / BLUE**. Allow camera access and wait for the movement model to load. There is one default shared space; no room code, sign-in, or setup form is needed.

Stand far enough from the camera to keep your shoulders and wrists visible. Raise either hand and wave from side to side. A still raised hand does not count as a wave.

- One person waving creates small traces in their own color, visible on both screens.
- Both people waving together for 200 ms establishes the relationship and generates a stronger purple form.
- Larger, faster waves increase the energy. Lower hands pull the visuals downward.
- When either person stops, the shared purple form fades over approximately three seconds.

The webcam image stays on its own computer. Only normalized wrist positions, movement energy, and wave state travel between the participants. No audio is requested. Choose **Change presence** to release the camera and pick the other role.

## Run locally

Node.js 18 or later is enough. No npm installation is needed:

```sh
npm start
```

Open `http://localhost:8080` on each computer. Both computers run their own copy and connect through the public p5LiveMedia signaling service. Do not open `index.html` directly as a `file:` URL. An internet connection is required to load p5.js, ml5, the pose model, and to connect the peers.

## GitHub Pages

Edit files in `dist/`, then run:

```sh
npm test
npm run build
git add dist docs
git commit -m "Update installation"
git push
```

The Pages source is `main` → `/docs`. `docs/.nojekyll` ensures the JavaScript files are served as plain static assets. Asset URLs are relative, so the project works under a GitHub repository URL prefix.

## Testing and tuning

Append `?input=keyboard` to the URL to test the exact two-person connection without camera input. Choose A and B as usual and hold Space on both computers. The normal page only shows this fallback if the camera fails. Append `&transport=webrtc` to disable the local-tab BroadcastChannel shortcut while testing real WebRTC.

`npm test` covers real-wave detection, stationary/noisy hands, missing tracking, two-sided connection, heartbeat freshness, and fade behavior. Tune gesture thresholds in `dist/gesture.js`, connection state in `dist/app.js`, and generative graphics in `dist/visuals.js`.

The default p5LiveMedia connection uses STUN without a TURN relay. It can fail on some restrictive campus networks or VPNs. If both people stay at “Waiting to join,” try a common Wi-Fi network or a personal hotspot, and reopen the page. This prototype uses a public signaling service rather than an installation-owned relay.

References: [p5LiveMedia](https://github.com/vanevery/p5LiveMedia), [ml5 BodyPose](https://github.com/ml5js/ml5-next-gen/blob/v1.3.1/src/BodyPose/index.js), [p5.js](https://p5js.org/).
