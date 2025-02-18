import express from 'express'
import bodyParser from 'body-parser'
import { JSONFileSyncPreset } from 'lowdb/node'

interface Expense {
    name: string
    value: number
    type: string
    installments: number
}

const defaultData: Expense[] = []

const db = JSONFileSyncPreset<Expense[]>('db.json', defaultData)

db.write()

const app = express()
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.sendFile('index.html', { root: '.' });
})

app.get('/expenses', (req, res) => {
    const expenses = db.data

    res.send(expenses)
})

app.post('/expense', (req, res) => {
    const expense = {
        name: req.body.name,
        type: "comida",
        value: 50,
        date: "10/12/2024",
        installments: 1
    }
    
    db.data.push(expense)
    db.write()

    res.redirect('/')
})

app.listen(3000, function () {
    console.log('listening on port 3000')
})