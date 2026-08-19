# extended-html

Use browser JavaScript APIs as build-free HTML custom elements.

## Use `<web-socket>`

Import the aggregate entry point to register the available elements:

```html
<script type="module">
  import "./src/index.js";
</script>
```

Add a WebSocket connection to HTML and handle its wrapped events:

```html
<web-socket
  url="wss://echo.websocket.org"
  auto
  onmessage="OnMessage(event)"
></web-socket>

<script>
  function OnMessage(event) {
    console.log(event.detail.data);
    console.log(event.detail.metadata.transport);
  }
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

## Guides and examples

- [English User Guide](https://koseki2580.github.io/extended-html/guide/en/)
- [日本語ユーザーガイド](https://koseki2580.github.io/extended-html/guide/ja/)
- [Interactive examples](https://koseki2580.github.io/extended-html/examples/)
