/**
 * Makes the global `EventTarget` of happy-dom look as in a browser, before the
 * runtime of async-browser-context loads. Runs before each test file of the
 * "browser runtime" project.
 *
 * In a browser, `EventTarget` is a data property of the global object, and
 * `EventTarget.prototype` has `addEventListener()`. In the happy-dom
 * environment of Vitest, the global is an accessor, and it gives a subclass
 * whose prototype has no methods: the methods are on its parent class. The
 * runtime patches only own data properties, as in a browser, so it would not
 * patch `addEventListener()` here.
 */
const global = Object.getOwnPropertyDescriptor(globalThis, "EventTarget");
const eventTarget: unknown = global?.get ? global.get.call(globalThis) : global?.value;

/** The prototype in the chain of `prototype` that has addEventListener() */
function prototypeWithListeners(prototype: object | null): object | null {
  if (prototype === null || Object.hasOwn(prototype, "addEventListener")) {
    return prototype;
  }
  return prototypeWithListeners(Object.getPrototypeOf(prototype) as object | null);
}

if (typeof eventTarget === "function") {
  const prototype = prototypeWithListeners(eventTarget.prototype as object);
  Object.defineProperty(globalThis, "EventTarget", {
    value: prototype?.constructor ?? eventTarget,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}
