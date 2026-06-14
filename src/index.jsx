import { BrowserRouter } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import React from 'react'

import 'bootstrap/dist/css/bootstrap.css'
import 'startbootstrap-simple-sidebar/dist/css/styles.css'

// Self-hosted fonts (bundled by Vite → no CDN dependency on the Pi).
// Chakra Petch = display, IBM Plex Sans = body, IBM Plex Mono = telemetry data.
import '@fontsource/chakra-petch/500.css'
import '@fontsource/chakra-petch/600.css'
import '@fontsource/chakra-petch/700.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'

// Ground Station theme — must load last so its overrides win the cascade.
import './css/styles.css'

import AppRouter from './AppRouter'
import * as serviceWorker from './serviceWorker'

const container = document.getElementById('root')
const root = createRoot(container)
root.render(<BrowserRouter>
              <AppRouter />
            </BrowserRouter>)

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: http://bit.ly/CRA-PWA
serviceWorker.unregister()
