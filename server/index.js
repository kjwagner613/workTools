import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

dotenv.config()

const { MONGO_DB, JWT_SECRET, PORT = 5000, CLIENT_ORIGIN } = process.env

if (!MONGO_DB) {
  throw new Error('Missing MONGO_DB in environment')
}
if (!JWT_SECRET) {
  throw new Error('Missing JWT_SECRET in environment')
}

mongoose
  .connect(MONGO_DB)
  .then(() => {
    console.log('Connected to MongoDB')
  })
  .catch((error) => {
    console.error('MongoDB connection error', error)
    process.exit(1)
  })

const userSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
  },
  { timestamps: true }
)

userSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject()
  delete obj.passwordHash
  return obj
}

const workTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    rate: { type: Number, required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

const entrySchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    workTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkType',
      required: true,
    },
    workTypeName: { type: String, required: true },
    rate: { type: Number, required: true },
    hours: { type: Number, required: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
    clientName: { type: String, trim: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
    projectName: { type: String, trim: true },
    billed: { type: Boolean, default: false },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

const clientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
  },
  { timestamps: true }
)

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  },
  { timestamps: true }
)

const User = mongoose.model('User', userSchema)
const WorkType = mongoose.model('WorkType', workTypeSchema)
const Entry = mongoose.model('Entry', entrySchema)
const Client = mongoose.model('Client', clientSchema)
const Project = mongoose.model('Project', projectSchema)

const app = express()

const allowedOrigins = (
  CLIENT_ORIGIN || 'http://localhost:5173,http://localhost:5174'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

app.use(
  cors({
    origin: allowedOrigins,
  })
)
app.use(express.json())

const signToken = (user) =>
  jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, {
    expiresIn: '7d',
  })

const authMiddleware = async (req, res, next) => {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) {
    return res.status(401).json({ message: 'Missing auth token' })
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const user = await User.findById(payload.id)
    if (!user) {
      return res.status(401).json({ message: 'User not found' })
    }
    req.user = user
    next()
  } catch (error) {
    return res.status(401).json({ message: 'Invalid auth token' })
  }
}

const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' })
  }
  return next()
}

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password required' })
  }
  const user = await User.findOne({ email: email.toLowerCase() })
  if (!user) {
    return res.status(401).json({ message: 'Invalid credentials' })
  }
  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) {
    return res.status(401).json({ message: 'Invalid credentials' })
  }
  const token = signToken(user)
  return res.json({ token, user: user.toJSON() })
})

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user.toJSON() })
})

app.get('/api/admin/users', authMiddleware, adminOnly, async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 })
  res.json({ users })
})

app.post('/api/admin/users', authMiddleware, adminOnly, async (req, res) => {
  const { name, email, password, role } = req.body
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password required' })
  }
  const existing = await User.findOne({ email: email.toLowerCase() })
  if (existing) {
    return res.status(409).json({ message: 'User already exists' })
  }
  const passwordHash = await bcrypt.hash(password, 10)
  const newUser = await User.create({
    name,
    email: email.toLowerCase(),
    passwordHash,
    role: role === 'admin' ? 'admin' : 'user',
  })
  res.status(201).json({ user: newUser.toJSON() })
})

app.post(
  '/api/admin/users/:id/reset-password',
  authMiddleware,
  adminOnly,
  async (req, res) => {
    const { password } = req.body
    if (!password) {
      return res.status(400).json({ message: 'Password required' })
    }
    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }
    user.passwordHash = await bcrypt.hash(password, 10)
    await user.save()
    res.json({ message: 'Password updated' })
  }
)

app.get('/api/work-types', authMiddleware, async (req, res) => {
  const workTypes = await WorkType.find({ owner: req.user._id }).sort({
    createdAt: -1,
  })
  res.json({ workTypes })
})

app.get('/api/clients', authMiddleware, async (req, res) => {
  const clients = await Client.find().sort({ name: 1 })
  res.json({ clients })
})

app.post('/api/clients', authMiddleware, adminOnly, async (req, res) => {
  const { name } = req.body
  if (!name) {
    return res.status(400).json({ message: 'Name required' })
  }
  const existing = await Client.findOne({ name: name.trim() })
  if (existing) {
    return res.status(409).json({ message: 'Client already exists' })
  }
  const client = await Client.create({ name })
  res.status(201).json({ client })
})

app.put('/api/clients/:id', authMiddleware, adminOnly, async (req, res) => {
  const { name } = req.body
  const client = await Client.findById(req.params.id)
  if (!client) {
    return res.status(404).json({ message: 'Client not found' })
  }
  if (name) {
    client.name = name
  }
  await client.save()
  res.json({ client })
})

app.delete('/api/clients/:id', authMiddleware, adminOnly, async (req, res) => {
  const client = await Client.findById(req.params.id)
  if (!client) {
    return res.status(404).json({ message: 'Client not found' })
  }
  const used = await Entry.exists({ clientId: client._id })
  if (used) {
    return res.status(400).json({ message: 'Client is used in entries' })
  }
  await Project.deleteMany({ clientId: client._id })
  await client.deleteOne()
  res.json({ message: 'Deleted' })
})

app.get('/api/projects', authMiddleware, async (req, res) => {
  const projects = await Project.find().sort({ name: 1 })
  res.json({ projects })
})

app.post('/api/projects', authMiddleware, adminOnly, async (req, res) => {
  const { name, clientId } = req.body
  if (!name) {
    return res.status(400).json({ message: 'Name required' })
  }
  const existing = await Project.findOne({ name: name.trim() })
  if (existing) {
    return res.status(409).json({ message: 'Project already exists' })
  }
  let client = null
  if (clientId) {
    client = await Client.findById(clientId)
    if (!client) {
      return res.status(404).json({ message: 'Client not found' })
    }
  }
  const project = await Project.create({ name, clientId: client?._id })
  res.status(201).json({ project })
})

app.put('/api/projects/:id', authMiddleware, adminOnly, async (req, res) => {
  const { name, clientId } = req.body
  const project = await Project.findById(req.params.id)
  if (!project) {
    return res.status(404).json({ message: 'Project not found' })
  }
  if (name) {
    project.name = name
  }
  if (clientId === '') {
    project.clientId = undefined
  } else if (clientId) {
    const client = await Client.findById(clientId)
    if (!client) {
      return res.status(404).json({ message: 'Client not found' })
    }
    project.clientId = client._id
  }
  await project.save()
  res.json({ project })
})

app.delete('/api/projects/:id', authMiddleware, adminOnly, async (req, res) => {
  const project = await Project.findById(req.params.id)
  if (!project) {
    return res.status(404).json({ message: 'Project not found' })
  }
  const used = await Entry.exists({ projectId: project._id })
  if (used) {
    return res.status(400).json({ message: 'Project is used in entries' })
  }
  await project.deleteOne()
  res.json({ message: 'Deleted' })
})

app.post('/api/work-types', authMiddleware, async (req, res) => {
  const { name, rate } = req.body
  if (!name || !rate) {
    return res.status(400).json({ message: 'Name and rate required' })
  }
  const workType = await WorkType.create({
    name,
    rate,
    owner: req.user._id,
  })
  res.status(201).json({ workType })
})

app.put('/api/work-types/:id', authMiddleware, async (req, res) => {
  const { name, rate } = req.body
  const workType = await WorkType.findOne({
    _id: req.params.id,
    owner: req.user._id,
  })
  if (!workType) {
    return res.status(404).json({ message: 'Work type not found' })
  }
  if (name) {
    workType.name = name
  }
  if (rate) {
    workType.rate = rate
  }
  await workType.save()
  res.json({ workType })
})

app.delete('/api/work-types/:id', authMiddleware, async (req, res) => {
  const workType = await WorkType.findOne({
    _id: req.params.id,
    owner: req.user._id,
  })
  if (!workType) {
    return res.status(404).json({ message: 'Work type not found' })
  }
  const used = await Entry.exists({ workTypeId: workType._id })
  if (used) {
    return res
      .status(400)
      .json({ message: 'Work type is used in entries' })
  }
  await workType.deleteOne()
  res.json({ message: 'Deleted' })
})

app.get('/api/entries', authMiddleware, async (req, res) => {
  const filter = { owner: req.user._id }
  if (req.user.role === 'admin' && req.query.all === 'true') {
    delete filter.owner
  }
  const entries = await Entry.find(filter)
    .sort({ date: -1, createdAt: -1 })
    .populate('owner', 'email name')
  res.json({ entries })
})

app.post('/api/entries', authMiddleware, async (req, res) => {
  const { date, workTypeId, hours, clientId, projectId } = req.body
  if (!date || !workTypeId || !hours) {
    return res
      .status(400)
      .json({ message: 'Date, work type, and hours required' })
  }
  const workType = await WorkType.findOne({
    _id: workTypeId,
    owner: req.user._id,
  })
  if (!workType) {
    return res.status(404).json({ message: 'Work type not found' })
  }
  let client = null
  if (clientId) {
    client = await Client.findById(clientId)
    if (!client) {
      return res.status(404).json({ message: 'Client not found' })
    }
  }
  let project = null
  if (projectId) {
    project = await Project.findById(projectId)
    if (!project) {
      return res.status(404).json({ message: 'Project not found' })
    }
  }

  const entry = await Entry.create({
    date,
    workTypeId: workType._id,
    workTypeName: workType.name,
    rate: workType.rate,
    hours,
    clientId: client?._id,
    clientName: client?.name,
    projectId: project?._id,
    projectName: project?.name,
    billed: false,
    owner: req.user._id,
  })
  res.status(201).json({ entry })
})

app.put('/api/entries/:id', authMiddleware, async (req, res) => {
  const entry = await Entry.findById(req.params.id)
  if (!entry) {
    return res.status(404).json({ message: 'Entry not found' })
  }
  const isOwner = entry.owner.toString() === req.user._id.toString()
  if (!isOwner && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Not authorized' })
  }

  const { date, hours, clientId, projectId, billed, workTypeId } = req.body
  if (date) {
    entry.date = date
  }
  if (typeof hours === 'number') {
    entry.hours = hours
  }
  if (typeof billed === 'boolean') {
    entry.billed = billed
  }
  if (clientId === '') {
    entry.clientId = undefined
    entry.clientName = undefined
  } else if (clientId) {
    const client = await Client.findById(clientId)
    if (!client) {
      return res.status(404).json({ message: 'Client not found' })
    }
    entry.clientId = client._id
    entry.clientName = client.name
  }
  if (projectId === '') {
    entry.projectId = undefined
    entry.projectName = undefined
  } else if (projectId) {
    const project = await Project.findById(projectId)
    if (!project) {
      return res.status(404).json({ message: 'Project not found' })
    }
    entry.projectId = project._id
    entry.projectName = project.name
  }
  if (workTypeId && workTypeId !== String(entry.workTypeId)) {
    const workType = await WorkType.findOne({
      _id: workTypeId,
      owner: entry.owner,
    })
    if (!workType) {
      return res.status(404).json({ message: 'Work type not found' })
    }
    entry.workTypeId = workType._id
    entry.workTypeName = workType.name
    entry.rate = workType.rate
  }

  await entry.save()
  res.json({ entry })
})

app.patch('/api/entries/bulk-billed', authMiddleware, async (req, res) => {
  const { entryIds, billed } = req.body
  if (!Array.isArray(entryIds) || typeof billed !== 'boolean') {
    return res.status(400).json({ message: 'Invalid payload' })
  }
  const filter = {
    _id: { $in: entryIds },
  }
  if (req.user.role !== 'admin') {
    filter.owner = req.user._id
  }
  await Entry.updateMany(filter, { billed })
  const updatedEntries = await Entry.find(filter)
  res.json({ entries: updatedEntries })
})

app.delete('/api/entries/:id', authMiddleware, async (req, res) => {
  const entry = await Entry.findById(req.params.id)
  if (!entry) {
    return res.status(404).json({ message: 'Entry not found' })
  }
  const isOwner = entry.owner.toString() === req.user._id.toString()
  if (!isOwner && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Not authorized' })
  }
  await entry.deleteOne()
  res.json({ message: 'Deleted' })
})

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`)
})
