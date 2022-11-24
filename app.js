const express = require("express")
const app = express()
const { Server:HttpServer } = require("http")
const httpServer = new HttpServer(app)
const { Server:ServerIo } = require("socket.io")
const io = new ServerIo(httpServer)
const cookieParser = require('cookie-parser')
const logger = require('morgan')

const session = require('express-session')
const mongoStore = require('connect-mongo')

app.set("view engine", "pug")
app.set("views", "./views")

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static("public"))

app.use(cookieParser(process.env.SECRET_KEY_COOKIE || 'palabraSecreta'))

//inicializo el middleware
app.use(session({
    secret: process.env.SECRET_KEY_SESSION || 'palabraSecretaSession',
    resave: true,
    saveUninitialized: true,
    rolling: true,
    cookie: { maxAge: 600000 },
    store: mongoStore.create({mongoUrl: process.env.MONGO_URL || 'mongodb+srv://MaruinYork:backend@cluster0.n9vmygq.mongodb.net/?retryWrites=true&w=majority', mongoOptions:{useNewUrlParser:true, useUnifiedTopology: true}})
}))


//Requerir los modulos
const passport = require('passport')
const LocalStrategy = require('passport-local').Strategy
const bcrypt = require('bcrypt')

app.use(passport.initialize())
app.use(passport.session())

//////// utils /////////
const userModel = require('./DB/usuarios.model')

const isValidePassword = (user, password) => {
    return bcrypt.compareSync(password, user.password)
}

const createHash = (password) => {
    return bcrypt.hashSync(password, bcrypt.genSaltSync(10), null)
}

const checkAuth = (req, res, next) => {
    if (req.isAuthenticated()) {
        next()
    }else{
        res.redirect('/api/login')
    }
}

//PASSPORT, defino la estrategia de autenticacion
//Configuro el middleware para inicio de sesión: 
passport.use('login', new LocalStrategy(
    //Busca al usuario, password en la DB para autenticarlo
    async ( username, password, done )=>{
        let user = await userModel.findOne({username: username})

        if (!user) {
            console.log(`No existe el usuario ${username}`)
            return done(null, false, { message: 'Usuario no encontrado' })
        }
            
        if (!isValidePassword(user, password)) {
            console.log('Password incorrecto')
            return done(null, false, { message: 'Password incorrecto' })
        }
        done(null, user) //pasa el usuario autenticado a la función serializeUser()
    }
))

passport.use('signup', new LocalStrategy({
    passReqToCallback: true
}, async (req, username, password, done) => {
    let user = await userModel.findOne({username: username})

    if (user) {
        console.log(`El usuario ${username} ya existe`)
        return done(null, false, { message: 'El usuario ya existe' })
    }

    const newUser = new userModel({
        username: username,
        password: createHash(password) //asi queda encriptada
    })

    await newUser.save()

    return done(null, req.body)

}))


//Este método se encarga de guardar el id del usuario en la sesión

passport.serializeUser(function(user, cb) {
    process.nextTick(function() {
      return cb(null, {
        id: user['_id'],
        username: user.username
      });
    });
  });

//Este método toma el id de las sesiones y si existe lo deja pasar

passport.deserializeUser(function(user, cb) {
    process.nextTick(function() {
      return cb(null, user);
    });
  });


////////////////////////////////////////////

// Utilizo req.isAuthenticated para proteger las rutas el momento del login
app.get('/api/login', (req, res) => {
    if (req.isAuthenticated()) {
        res.redirect('/api/')
    } else {
        res.render('index', {username:undefined})
    }
})

//Con passport.authenticate como middleware especifico  successRedirect y failureRedirect,
app.post('/api/login', passport.authenticate('login',{
    successRedirect: '/api/',
    failureRedirect: '/api/login'
}),(req, res) => { 
    res.redirect('/api/')
})

app.get('/api/signup', (req, res) => {
    if (req.isAuthenticated()) {
        res.redirect('/api/')
    } else {
        res.render('index', {username:'wip'})
    }
})

//Con passport.authenticate como middleware especifico  successRedirect y failureRedirect,
app.post('/api/signup', passport.authenticate('signup',{
    successRedirect: '/api/',
    failureRedirect: '/api/login'
}),(req, res) => {
    res.redirect('/api/')
})

//Uso req.logout para limpiar la sesion req.session.passport
app.get('/api/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) { return next(err) }
        res.redirect('/api/login')
    })
})

//////////////////////////////////////////////////////

const productsRouter = require('./routes/Productos')
const testRouter = require('./routes/Test')

app.use("/api/", checkAuth, productsRouter)
app.use("/api/", testRouter)


app.use( (req, res) => {
    res.status(404);
    res.send("Prueba: http://localhost:5000/api/login");
})


////////////////////////CLIENTE///////////////////////

const ProductosDaos = require('./daos/ProductosDaos')
const db = new ProductosDaos()

//
const ChatDaosFirebase = require('./daos/ChatDaosFirebase')
const { Session } = require("inspector")
const chatdb = new ChatDaosFirebase()
//
io.on('connection', (socket) => {
    console.log('🟢 Usuario conectado')

    db.get().then((products) => {
        socket.emit('connection', {"products": products})
    }).catch((err) => {
        console.log(err) ; throw err
    })

    //
    chatdb.crudChat().then((chat) => {
        socket.emit('connection', {"chat":chat})
    }).catch((err) => {
        console.log(err) ; throw err
    })
    //

    // Nuevos productos
    socket.on('postProduct', (product) => {
        db.add(product)
        io.emit('postProduct', product)
    })

    // Nuevos mensajes del chat
    socket.on('chatter', (message) => {
        chatdb.crudChat(message)
        io.emit('chatter', message)
    })
    socket.on('disconnect', () => {
        console.log('🔴 Usuario desconectado')
    })
    //
})

//////////////////////////////////////////////////////

module.exports = {
    app,
    httpServer,
    io
}