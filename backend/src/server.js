import express from "express";
import allowCors from './config/cors.js'

const server = express()
const port = 3003
server.use(express.urlencoded({extended: true}))
server.use(express.json())
server.use(allowCors)

server.listen(port, function() {
    console.log(`BACKEND is running on port ${port}`)
})

// server.get("/", (req: Request, res: Response) => {
//   res.send("Express + TypeScript Server");
// });

// server.listen(port, () => {
//   console.log(`[server]: Server is running at http://localhost:${port}`);
// });

// module.exports = server