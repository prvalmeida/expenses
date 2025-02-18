import express from 'express'
import indexRouter from './routes/index.js'
import bodyParser from 'body-parser';

const app = express()
const port = process.env.PORT || 3000

app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use("/", indexRouter);

app.listen(3000, function () {
    console.log('listening on port 3000')
})