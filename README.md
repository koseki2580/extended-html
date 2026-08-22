# Extended HTML

Use browser JavaScript APIs as build-free HTML custom elements.

Register every available custom element directly from GitHub Pages:

```html
<script type="module" src="https://koseki2580.github.io/extended-html/src/index.js"></script>
```

## Use `<web-socket>`

Add a WebSocket connection to HTML and handle its wrapped events:

```html
<web-socket
  url="wss://echo.websocket.org"
  auto
  onmessage="OnMessage(event)"
></web-socket>

<script type="module">
  function OnMessage(event) {
    console.log(event.detail.data);
    console.log(event.detail.metadata.transport);
  }

  globalThis.OnMessage = OnMessage;
</script>
```

The same element can be controlled from JavaScript:

```js
const socket = document.querySelector("web-socket");

socket.open();
socket.send("hello");
socket.close();
```

Add the `background` attribute to run the connection in a dedicated Worker
without changing the methods or events:

```html
<web-socket
  url="wss://echo.websocket.org"
  auto
  background
></web-socket>
```

## Use `<audio-context>`

Register only the five Audio elements when the aggregate entry is not needed:

```html
<script type="module" src="https://koseki2580.github.io/extended-html/src/audio/index.js"></script>
```

Describe the audio graph through nesting, then start every source with one
user-initiated `resume()` call:

```html
<audio-context id="audio">
  <audio-input-file src="./music.mp3">
    <audio-biquad-filter type="lowpass" frequency="1200">
      <audio-output></audio-output>
    </audio-biquad-filter>
  </audio-input-file>
</audio-context>

<button id="start" type="button">Start audio</button>

<script type="module">
  const audio = document.querySelector("#audio");
  const start = document.querySelector("#start");

  start.addEventListener("click", async () => {
    await audio.resume();
  });
</script>
```

## Guides and examples

- [English User Guide](https://koseki2580.github.io/extended-html/guide/en/)
- [日本語ユーザーガイド](https://koseki2580.github.io/extended-html/guide/ja/)
- [Interactive examples](https://koseki2580.github.io/extended-html/examples/)
