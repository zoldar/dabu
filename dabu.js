"use strict";

// This is most likely going to be turned into a module,
// eventually.
(function () {
  class Point {
    PRECISION = 5
    PRECISION_FRACTION = Math.pow(10, -5)

    x; y

    constructor(x, y) {
      this.x = x
      this.y = y
    }

    static at(x, y) {
      return new Point(x, y)
    }

    add(p) {
      return new Point(this.x + p.x, this.y + p.y)
    }

    subtract(p) {
      return new Point(this.x - p.x, this.y - p.y)
    }

    multiply(n) {
      return new Point(this.x * n, this.y * n)
    }

    divide(n) {
      return new Point(this.x / n, this.y / n)
    }

    round(precision) {
      return new Point(Math.round(this.x, precision), Math.round(this.y, precision))
    }

    equals(p) {
      return Math.abs(this.x - p.x) < this.PRECISION_FRACTION &&
        Math.abs(this.y - p.y) < this.PRECISION_FRACTION
    }

    vertical() {
      return this.x == 0 && this.y != 0
    }

    horizontal() {
      return this.x != 0 && this.y == 0
    }

    normalize() {
      if (this.x == 0 || this.y == 0) {
        return this.divide(Math.abs(this.x || this.y))
      } else {
        return this.divide(Math.sqrt(this.x * this.x + this.y * this.y))
      }
    }

    distance(p) {
      let delta = this.subtract(p)
      return Math.sqrt(delta.x * delta.x + delta.y * delta.y)
    }

    directionName() {
      if (this.x > 0 && this.y == 0) return 'right'
      if (this.x < 0 && this.y == 0) return 'left'
      if (this.x == 0 && this.y > 0) return 'down'
      if (this.x == 0 && this.y < 0) return 'up'
      return 'none'
    }
  }

  Point.UP = Point.at(0, -1)
  Point.DOWN = Point.at(0, 1)
  Point.LEFT = Point.at(-1, 0)
  Point.RIGHT = Point.at(1, 0)

  class Scene {
    cameraOrigin = Point.at(0, 0)
    groups = {}
    entities = {}

    has(e) {
      return this.entities[e.hash] !== undefined
    }

    add(e, group) {
      this.entities[e.hash] = e

      if (group) {
        let groups = group instanceof Array ? group : [group]

        groups.forEach(g => {
          if (this.groups[g]) {
            this.groups[g].add(e.hash)
          } else {
            this.groups[g] = new Set([e.hash])
          }
        })
      }
    }

    remove(e) {
      Object.values(this.groups).forEach(g => g.delete(e.hash))
      delete this.entities[e.hash]
    }

    getGroup(name) {
      if (this.groups[name]) {
        return Array.from(this.groups[name].values()).map(hash => this.entities[hash])
      } else {
        return []
      }
    }
  }

  class BoundingBox {
    _position
    offset
    width
    height

    constructor(position, offset, width, height) {
      this.offset = offset
      this._position = position.round().add(offset)
      this.width = width
      this.height = height
    }

    set position(position) {
      this._position = position.round().add(this.offset)
    }

    get position() {
      return this._position
    }

    collides(box2) {
      let position1 = this.position
      let position2 = box2.position

      return position1.x < position2.x + box2.width &&
        position1.x + this.width > position2.x &&
        position1.y < position2.y + box2.height &&
        position1.y + this.height > position2.y
    }
  }

  class Sprite {
    _name
    timestamp
    fps
    endCallback
    endCallbackCalled = false

    constructor(name, fps, endCallback) {
      this._name = name
      this.timestamp = performance.now()
      this.fps = fps || 10
      this.endCallback = endCallback
    }

    set name(name) {
      if (this._name != name) {
        this._name = name
        this.timestamp = performance.now()
      }
    }

    get name() {
      return this._name
    }
  }
  class DynamicEntity {
    hash
    previousPosition
    _position
    _direction = Point.DOWN
    _velocity = 0
    kinetic = true
    sprite
    collisionShape
    hitShape
    zindex = 0

    constructor(position) {
      this.hash = `${this.constructor.name}#${entityHashIndex++}`
      this._position = position
      this.previousPosition = position

      // extending class must provide collisionShape, hitShape and sprite
    }

    get position() {
      return this._position
    }

    set position(position) {
      this._position = position
      if (this.collisionShape) {
        this.collisionShape.position = position
      }
      if (this.hitShape) {
        this.hitShape.position = position
      }
    }

    get direction() {
      return this._direction
    }

    set direction(direction) {
      this._direction = direction
    }

    get velocity() {
      return this._velocity
    }

    set velocity(velocity) {
      this._velocity = velocity
    }

    update() {
      if (!this._position.equals(this.previousPosition)) {
        this.previousPosition = this._position
      }
    }
  }

  class StaticEntity {
    hash
    position
    sprite
    collisionShape
    hitShape
    zindex = 0

    constructor(position, sprite, collisionShape, hitShape) {
      this.hash = `${this.constructor.name}#${entityHashIndex++}`
      this.position = position
      this.sprite = sprite
      this.collisionShape = collisionShape
      this.hitShape = hitShape
    }
  }

  // internal state
  let entityHashIndex = 0
  let imagePromises = []
  let spritePromises = []
  let definedSprites = []
  let keyHandlers = new Map()
  let clickHandlers = new Map()
  let bgCanvas
  let gameCanvas
  let oldTimestamp = performance.now()
  let requestAnimationFrameId
  let keysDown = {}
  let keyUpEvent

  // public state context
  let ctx = {
    bgContext: null,
    gameContext: null,
    images: {},
    sprites: {},
    keys: {},
    signals: {},
    mouseX: 0,
    mouseY: 0,
    mouseButton: false,
  }

  function init(stageParentId, width, height) {
    setupCanvas(stageParentId, width, height)
    setupControls()
  }

  async function load(initFunc, renderFunc, opts) {
    let maxFPS = opts.maxFPS || 60

    if (requestAnimationFrameId) {
      window.cancelAnimationFrame(requestAnimationFrameId)
    }

    clearCanvas()

    let state = initFunc()

    let gameLoop = (timestamp) => {
      // Keep requesting new frames
      requestAnimationFrameId = window.requestAnimationFrame(gameLoop)

      // Skip frame drawing if not enough time has passed
      if (timestamp < oldTimestamp + (1000 / maxFPS)) return

      // Calculate the number of seconds passed since the last frame
      // with a maximum of 0.1 second.
      let secondsPassed = Math.min(0.1, (timestamp - oldTimestamp) / 1000)
      oldTimestamp = timestamp

      renderFunc(state, secondsPassed)
    }

    Promise.all(imagePromises).then(loadedImages => {
      loadedImages.forEach(([name, image]) => {
        ctx.images[name] = image
      })
    }).then(() => {
      return Promise.all(spritePromises.map(p => p()))
    }).then(() => {
      definedSprites.forEach(cb => cb())

      requestAnimationFrameId = window.requestAnimationFrame(gameLoop)
    })
  }

  function setupCanvas(stageParentId, width, height) {
    let document = window.document
    let parent = document.getElementById(stageParentId)
    parent.classList.add("stage")

    bgCanvas = document.createElement('canvas')
    bgCanvas.setAttribute('id', 'bg-layer')
    bgCanvas.setAttribute('width', width)
    bgCanvas.setAttribute('height', height)
    gameCanvas = document.createElement('canvas')
    gameCanvas.setAttribute('id', 'game-layer')
    gameCanvas.setAttribute('width', width)
    gameCanvas.setAttribute('height', height)

    parent.appendChild(bgCanvas)
    parent.appendChild(gameCanvas)

    ctx.bgContext = bgCanvas.getContext('2d')
    ctx.bgContext.imageSmoothingEnabled = false
    ctx.gameContext = gameCanvas.getContext('2d')
    ctx.gameContext.imageSmoothingEnabled = false
  }

  function clearCanvas() {
    ctx.bgContext.clearRect(0, 0, bgCanvas.width, bgCanvas.height)
    ctx.gameContext.clearRect(0, 0, gameCanvas.width, gameCanvas.height)
  }

  function setupControls() {
    window.addEventListener('keydown', e => {
      // disable key repeating
      if (keysDown[e.key]) return

      let key = keyHandlers.has(e.key) ? e.key : 'any'
      keyUpEvent = keyHandlers.get(key)

      keysDown[e.key] = true
      ctx.keys[e.key] = true
    })

    window.addEventListener('keyup', e => {
      if (keyUpEvent) {
        keyUpEvent.callback()
        keyUpEvent = null
      }

      keysDown[e.key] = false
      ctx.keys[e.key] = false
    })

    window.addEventListener('blur', e => {
      ctx.keys = {}
    })

    window.addEventListener('unload', e => {
      ctx.keys = {}
    })

    window.addEventListener("mousemove", e => {
      let [cx, cy] = translateToCanvasPosition(e.clientX, e.clientY)

      ctx.mouseX = cx
      ctx.mouseY = cy
    });

    window.addEventListener('click', e => {
      clickHandlers.forEach(({ box, callback }, key) => {
        if (ctx.mouseX >= box.position.x && ctx.mouseX < box.position.x + box.width &&
          ctx.mouseY >= box.position.y && ctx.mouseY < box.position.y + box.height) {
          callback()
        }
      })
    })

    window.addEventListener("mousedown", e => {
      ctx.mouseButton = true;
    })

    window.addEventListener("mouseup", e => {
      ctx.mouseButton = false;
    })
  }

  function translateToCanvasPosition(x, y) {
    let cx, cy
    let canvasRatio = gameCanvas.width / gameCanvas.height
    let fullWidth = gameCanvas.scrollWidth
    let realHeight = gameCanvas.scrollHeight
    let realWidth = realHeight * canvasRatio
    let xOffset = (fullWidth - realWidth) / 2

    let relativeX = x - (gameCanvas.offsetLeft + xOffset)
    if (relativeX <= 0) {
      cx = 0
    } else if (relativeX > 0 && relativeX < realWidth) {
      cx = Math.round((relativeX / realWidth) * gameCanvas.width)
    } else {
      cx = gameCanvas.width
    }

    let relativeY = y - gameCanvas.offsetTop
    if (relativeY <= 0) {
      cy = 0
    } if (relativeY > 0 && relativeY < realHeight) {
      cy = Math.round((relativeY / realHeight) * gameCanvas.height)
    } else {
      cy = gameCanvas.height
    }

    return [cx, cy]
  }

  function getCollisions(entity, otherEntities, shapeType) {
    let collisions = []

    let entityShape = shapeType == 'hit' ? entity.hitShape : entity.collisionShape

    if (entityShape) {
      otherEntities.forEach(e => {
        let eShape = shapeType == 'hit' ? e.hitShape : e.collisionShape

        if (eShape && entityShape.collides(eShape)) {
          collisions.push(e)
        }
      })
    }

    return collisions
  }

  function runPhysics({ entities }, secondsPassed) {
    Object.entries(entities).forEach(([key, entity]) => {
      if (entity instanceof DynamicEntity && entity.kinetic) {
        entity.position = entity.position.add(entity.direction.multiply(entity.velocity * secondsPassed))
      }

      if (entity instanceof DynamicEntity && entity.collisionShape && entity.velocity > 0) {
        let collisionOccurred = false
        Object.entries(entities).forEach(([otherKey, otherEntity]) => {
          if (otherEntity.collisionShape &&
            key != otherKey &&
            entity.collisionShape.collides(otherEntity.collisionShape)) {
            collisionOccurred = true
          }
        })

        if (collisionOccurred && entity.previousPosition) {
          entity.position = entity.previousPosition
        }
      }

      if (entity.update) entity.update()
    })
  }

  function clearScreen() {
    ctx.gameContext.clearRect(0, 0, gameCanvas.width, gameCanvas.height)
  }

  function loadImage(name, source) {
    imagePromises.push(new Promise(resolve => {
      let img = new Image()
      img.onload = () => {
        resolve([name, img])
      }
      img.src = source
    }))
  }

  function loadSprite(name, imageSource, { x, y }, width, height, opts) {
    spritePromises.push(() => new Promise(resolve => {
      let { xGap = 0, count = 1 } = opts || {}

      if (count > 1) {
        for (let idx = 0; idx < count; idx++) {
          createImageBitmap(ctx.images[imageSource], x + idx * (width + xGap), y, width, height).then(bitmap => {
            if (ctx.sprites[name]) {
              ctx.sprites[name].push(bitmap)
            } else {
              ctx.sprites[name] = [bitmap]
            }
            resolve()
          })
        }
      } else {
        createImageBitmap(ctx.images[imageSource], x, y, width, height).then(bitmap => {
          ctx.sprites[name] = bitmap
          resolve()
        })
      }
    }))
  }

  function defineSprite(name, spriteNames) {
    definedSprites.push(() => {
      ctx.sprites[name] = spriteNames.map(n => ctx.sprites[n])
    })
  }

  function drawScene(scene, opts) {
    clearScreen()
    Object.values(
      scene.entities
    ).toSorted(
      (e1, e2) => e1.zindex - e2.zindex
    ).forEach(
      entity => drawEntity(scene.cameraOrigin, entity, opts)
    )
  }

  function drawEntity(origin, entity, opts) {
    let { position, sprite } = entity
    if (sprite instanceof Function) {
      sprite(position.subtract(origin).round())
    } else {
      let { x, y } = position.subtract(origin).round()
      let sprites = ctx.sprites[sprite.name]
      let spriteFrame

      if (sprites instanceof Array) {
        let frame

        if (sprite.endCallbackCalled) {
          frame = sprites.length - 1
        } else {
          let msPerFrame = 1000 / sprite.fps
          frame = Math.floor(((performance.now() - sprite.timestamp) / msPerFrame)) % sprites.length
        }

        if (sprite.endCallback &&
          !sprite.endCallbackCalled &&
          frame == sprites.length - 1) {
          sprite.endCallbackCalled = true
          sprite.endCallback()
        }

        spriteFrame = sprites[frame]
      } else {
        spriteFrame = sprites
      }

      ctx.gameContext.drawImage(spriteFrame, x, y)

      if (entity.collisionShape && opts && opts.drawCollisionShapes) {
        let { position, width, height } = entity.collisionShape
        let shapePosition = position.subtract(origin).round()
        ctx.gameContext.strokeStyle = 'green'
        ctx.gameContext.lineWidth = 1
        ctx.gameContext.strokeRect(shapePosition.x, shapePosition.y, width, height)
      }

      if (entity.hitShape && opts && opts.drawHitShapes) {
        let { position, width, height } = entity.hitShape
        let shapePosition = position.subtract(origin).round()
        ctx.gameContext.strokeStyle = 'red'
        ctx.gameContext.lineWidth = 1
        ctx.gameContext.strokeRect(shapePosition.x, shapePosition.y, width, height)
      }
    }
  }

  function sendSignal(name, arg) {
    if (ctx.signals[name]) {
      ctx.signals[name].push(arg)
    } else {
      ctx.signals[name] = [arg]
    }
  }

  window.Dabu = {
    // Utility classes
    Point,
    BoundingBox,
    Scene,
    Sprite,
    StaticEntity,
    DynamicEntity,

    // Public API
    loadImage,
    loadSprite,
    defineSprite,
    init,
    load,
    clearScreen,
    drawScene,
    runPhysics,
    getCollisions,
    sendSignal,

    // Public context
    ctx
  }
})()