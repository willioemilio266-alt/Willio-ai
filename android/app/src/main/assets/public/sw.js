/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-7e5eb42b'], (function (workbox) { 'use strict';

  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "registerSW.js",
    "revision": "1872c500de691dce40960bb85481de07"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "aafcc49f0a25a86350c0bab8dc6d26c0"
  }, {
    "url": "pwa-512x512.png",
    "revision": "cbe47fae5968bbf0b326b0fc1db3a2f9"
  }, {
    "url": "pwa-192x192.png",
    "revision": "7cc7073e86ffc33315707076044b5e7b"
  }, {
    "url": "index.html",
    "revision": "dcbd78cf3e070f283fbefb8154c21ab4"
  }, {
    "url": "icon.svg",
    "revision": "c0334f51a4215e35e8758d1c590d9cb2"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "c8a86871734be86aaf5b12f669001af2"
  }, {
    "url": "assets/index-CRUhnz24.js",
    "revision": null
  }, {
    "url": "assets/index-Bu5qE28v.css",
    "revision": null
  }, {
    "url": "apple-touch-icon.png",
    "revision": "c8a86871734be86aaf5b12f669001af2"
  }, {
    "url": "icon.svg",
    "revision": "c0334f51a4215e35e8758d1c590d9cb2"
  }, {
    "url": "pwa-192x192.png",
    "revision": "7cc7073e86ffc33315707076044b5e7b"
  }, {
    "url": "pwa-512x512.png",
    "revision": "cbe47fae5968bbf0b326b0fc1db3a2f9"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "aafcc49f0a25a86350c0bab8dc6d26c0"
  }, {
    "url": "manifest.webmanifest",
    "revision": "83957e929a2d92527477dc730625ad4b"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api\//]
  }));

}));
