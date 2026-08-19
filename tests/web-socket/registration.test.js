import "../../src/web-socket/web-socket.js";

describe("web-socket individual entry point", () => {
  it("registers the web-socket element", () => {
    if (typeof customElements.get("web-socket") !== "function") {
      throw new Error("expected the individual module to register <web-socket>");
    }
  });
});
