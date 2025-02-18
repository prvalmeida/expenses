const e = require('express')
const _ = require('lodash')

// padrão de assinatura de um middleware express 
module.exports = (req, res, next) => {
    // node restful coloca resultado aqui
    const bundle = res.locals.bundle

    if (bundle.errors) {
        const errors = parseErrors(bundle.errors)

        res.status(500).json({errors})
    } else {
        next()
    }
}

// método que vai extratir um array de mensagens dos objetos de erro gerados pelo node restful
const parseErrors = (nodeRestfulErrors) => {
    const errors = []
    _.forIn(nodeRestfulErrors, error => errors.push(error.message))

    return errors
}