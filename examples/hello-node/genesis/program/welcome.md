# Open and edit the welcome page

People open the app to see a welcome message and click a counter. Editing
`index.html` changes the next page response without restarting the server.
The counter belongs to the current browser document and resets on reload.

## Sources
- `server.js`
- `index.html`
- `test/server.test.js`

## Public contract

`npm start` listens on localhost port 3000. Pass `-- --host 127.0.0.1 --port 4100`
to choose an address. `GET /` serves the page; `GET /api/health` returns HTTP 200
and `{"ok":true}`. Unknown paths return 404 and methods other than GET or HEAD
return 405. No application setup, secrets, or database preparation is needed.

`npm test` checks the real HTTP responses with one test file at a time.
