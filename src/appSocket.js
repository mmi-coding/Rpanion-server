import io from 'socket.io-client'

/*
 * One app-wide socket.io connection, shared across pages.
 *
 * Upstream opened a NEW socket in every page's constructor and tore it down on
 * unmount, so each navigation paid a full websocket handshake — noticeable
 * over a high-latency LTE link. Pages now share this singleton: basePage
 * removes the page's listeners on unmount but keeps the connection alive.
 */

let socket = null
let socketToken

export function getAppSocket (token) {
  if (socket !== null && socketToken !== token) {
    // credentials changed (login/logout) — reconnect with the new token
    socket.disconnect()
    socket = null
  }
  if (socket === null) {
    socketToken = token
    socket = io({
      extraHeaders: {
        authorization: `Bearer ${token}`
      }
    })
  }
  return socket
}

// logout path + test seam: drop the shared connection entirely
export function closeAppSocket () {
  if (socket !== null) {
    socket.disconnect()
    socket = null
  }
}
