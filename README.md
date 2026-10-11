# The Body Is Not the Boundary of the Self

A two-person installation made with p5.js, local webcam motion detection, and p5LiveMedia.

## Join with a friend

Open [the installation](https://irissss1121.github.io/body-beyond-boundaries/) on two computers. One person chooses **A / PINK** and the other chooses **B / BLUE**. Allow camera access, then move your hands, arms, or upper body. There is one default shared space; no room code, sign-in, or setup form is needed.

- One person moving creates small traces in their color, visible on both screens.
- Both people moving together for 200 ms creates a stronger shared purple form.
- Larger movements increase the energy. Movement lower in the frame pulls the visuals downward.
- When either person stops, the shared purple form fades over approximately three seconds.

A small preview shows your own camera and confirms when movement is detected. Camera frames are compared locally; no pose model or specific waving gesture is required. Keep the camera stationary, because movement elsewhere in its view can also create feedback. Uniform exposure changes and small pixel noise are filtered out.

The webcam image stays on its own computer. Only movement state, energy, and normalized vertical position travel between participants. No audio is requested. **Change presence** releases the camera and returns to the identity chooser.

## Preview without a partner

Choose **Preview demo** on the start screen, or **Demo** while in the space. A 16-second loop shows one person moving, both moving and creating purple, then the shared form fading. Both participants are explicitly labeled as simulated. No camera or peer connection is needed, and simulated movement is never sent to live participants. **Live mode** returns to the identity chooser.

## Run locally

Node.js 18 or later is enough. No npm installation is needed:

```sh
npm start
```

Open `http://localhost:8080` on each computer. Both computers run their own copy and connect through the public p5LiveMedia signaling service. Use HTTPS or localhost for camera access. An internet connection is required to load p5.js and to connect the peers; the demo also needs p5.js to load.

## GitHub Pages

Edit files in `dist/`, then run:

```sh
npm test
npm run build
git add dist docs tests README.md
git commit -m "Update installation"
git push
```

The Pages source is `main` → `/docs`. The build copies `dist/` into `docs/` and writes `.nojekyll`. Asset URLs are relative, so the project works under a GitHub repository URL prefix.

## Testing and tuning

Append `?input=keyboard` to test the two-person connection without camera input. Choose A and B and hold Space or **Hold to move**. The normal page shows this fallback only if the camera fails. Append `&transport=webrtc` to disable the local-tab BroadcastChannel shortcut while testing real WebRTC.

`npm test` checks motion from synthetic camera frames, stationary frames, exposure changes, pixel noise, movement expiry, and shared presence timing and fade. Tune motion thresholds in `dist/motion.js`, shared presence in `dist/gesture.js`, connection behavior in `dist/app.js`, and generative graphics in `dist/visuals.js`.

The p5LiveMedia connection uses STUN without a TURN relay and can fail on restrictive campus networks or VPNs. If the other participant stays at “Waiting to join,” try a common Wi-Fi network or a personal hotspot and rejoin. **Preview demo** remains available to check the visuals.

References: [p5LiveMedia](https://github.com/vanevery/p5LiveMedia), [p5.js](https://p5js.org/).
