const express = require('express')

module.exports = function (server) {
    /*
    * Rotas protegidas por Token JWT
    */
    const expensesApi = express.Router()
    server.use('/api', expensesApi)
    // protectedApi.use(auth)

    const Expenses = require('../api/expenses/expensesService')
    Expenses.register(expensesApi, '/expenses')
    
    /*
    * Rotas abertas
    */
    // const openApi = express.Router()
    // server.use('/oapi', openApi)
    // const AuthService = require('../api/user/authService')
    // openApi.post('/login', AuthService.login)
    // openApi.post('/signup', AuthService.signup)
    // openApi.post('/validateToken', AuthService.validateToken)

}