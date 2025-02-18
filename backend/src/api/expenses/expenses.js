const restful = require('node-restful')
const mongoose = restful.mongoose

// const expenseSchema = new mongoose.Schema({
//     name: { type: String, required: true},
//     value: { type: Number, min: 0, required: true},
//     type: { type: Schema.Types.Mixed, required: true}
// })

const expenseSchema = new mongoose.Schema({
    category: {
      type: String,
      enum: ['comida', 'viagens', 'carro', 'contas', 'compras', 'mercado'],
      required: true
    },
    subcategory: {
      type: Map,
      of: {
        name: { type: String, required: true },
        value: { type: Number, required: true },
        date: { type: Date, required: true },
        totalOfinstallments: { type: Number, required: false },
        installment: { type: Number, required: false }
      }

    }
  });

module.exports = restful.model('Expense', expenseSchema)