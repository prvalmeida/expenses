import server from './server'
import './config/database'
require('./config/routes')(server)