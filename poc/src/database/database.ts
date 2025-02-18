import { JSONFileSyncPreset } from 'lowdb/node'

export interface Expense {
    name: string
    value: number
    type: string
    installments: number
}

const defaultData: Expense[] = []

const db = JSONFileSyncPreset<Expense[]>('db.json', defaultData)

export default db
