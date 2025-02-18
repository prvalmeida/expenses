const Expenses = require('./expenses')
const errorHandler = require('../common/errorHandler')

Expenses.methods(['get', 'post', 'put', 'delete'])
Expenses.updateOptions({new: true, runValidators: true})

// aplicando middleware de tratamento de erro após um POST ou um PUT
Expenses.after('post', errorHandler).after('put', errorHandler)

Expenses.route('get', (req, res, next) => {
    BillingCycle.find({}, (err, docs) => {
        if(!err) {
            res.json(docs)
        } else {
            res.status(500).json({errors: [err]})
        }
    })
})

module.exports = BillingCycle