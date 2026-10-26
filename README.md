# Discord Video Shrinker

Shrink videos from your phone so they fit under Discord's upload limit. It runs **entirely in your browser**. Nothing gets uploaded, so a 200 MB clip converts in seconds instead of waiting on an upload and a download.

Works on **iPhone (Safari)**, **Android (Chrome)**, and desktop browsers.

## How to use

1. Open the site on your phone.
2. Tap **Choose a video** and pick one from your gallery.
3. Pick your upload limit (10 MB for free Discord accounts) and optionally trim it.
4. Tap **Shrink video**, then **Share to Discord…**, or **Save video**.

### Make it feel like an app

- **iPhone:** in Safari, tap Share, then **Add to Home Screen**.
- **Android:** in Chrome, tap ⋮, then **Install app**. After installing, **Shrinker shows up in the Android share sheet**, so you can share a video from your gallery straight into it.

Once it has loaded, it also works offline.

## How it works

- Uses the browser's built-in hardware video encoder ([WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)) through [Mediabunny](https://mediabunny.dev), so it's fast even on phones.
- Works out the bitrate from the clip length and your size limit, and picks a resolution that looks good at that bitrate (1080p, 720p, 540p, 480p, or 360p). High frame rates drop to 30 fps when bits are tight.
- Output is H.264 + AAC in MP4, which plays inline in Discord on every platform.
- If the encoder overshoots the limit, it automatically retries at a lower bitrate.

## Requirements

A browser with WebCodecs video encoding: Safari 16.4+ (iOS 16.4+), Chrome / Edge 94+, or Firefox 130+. If audio encoding isn't available, the video is exported without sound and you'll still get a file.

## Run it yourself

It's a static site with no build step.

```sh
npm start   # serves the folder at http://localhost:3000
npm test    # unit tests for the bitrate/resolution planner
```

To test on your phone from your computer, you need HTTPS (WebCodecs and service workers need a secure context). The easiest route is to deploy to GitHub Pages.

### Deploy to GitHub Pages

1. Fork or push this repo to GitHub.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**, then choose `main` and `/ (root)`.
3. Your copy will be live at `https://<username>.github.io/<repo>/`.

When you change any app file, bump `VERSION` in `sw.js` so installed copies pick up the update.

## Project layout

| File | What it does |
| --- | --- |
| `index.html`, `style.css` | UI |
| `app.js` | File picking, trimming, conversion, sharing |
| `plan.js` | Pure functions that choose the bitrate and resolution (unit-tested) |
| `sw.js` | Offline cache and the Android share target |
| `manifest.webmanifest` | PWA install metadata |
| `vendor/mediabunny.min.mjs` | Mediabunny v1.62.1 (MPL-2.0), vendored so there's no build step and no CDN dependency |

## Contributing

Issues and PRs are welcome. Please test on a real phone if you touch the conversion code, because mobile encoders behave differently from desktop ones.

## License

MIT for this project's code. Mediabunny is MPL-2.0. See `vendor/MEDIABUNNY-LICENSE`.
