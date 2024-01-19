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

    round(n, precision) {
      return new Point(Math.round(this.x, precision), Math.round(this.y, precision))
    }

    equals(p) {
      return Math.abs(this.x - p.x) < PRECISION_FRACTION &&
        Math.abs(this.y - p.y) < PRECISION_FRACTION
    }

    hash() {
      return Math.round(this.x, PRECISION) + '#' + Math.round(this.y, PRECISION)
    }

    vertical() {
      return this.x == 0 && this.y != 0
    }

    horizontal() {
      return this.x != 0 && this.y == 0
    }

    direction() {
      return this.divide(this)
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
    groups = {}
    entities = {}

    has(e) {
      return this.entities[this.hash(e)] !== undefined
    }

    add(e, group) {
      let hash = this.hash(e)
      this.entities[hash] = e

      if (group) {
        let groups = group instanceof Array ? group : [group]

        groups.forEach(g => {
          if (this.groups[g]) {
            this.groups[g].add(hash)
          } else {
            this.groups[g] = new Set([hash])
          }
        })
      }
    }

    remove(e) {
      let hash = this.hash(e)
      Object.values(this.groups).forEach(g => g.delete(hash))
      delete this.entities[hash]
    }

    hash(e) {
      if (e.hash) return e.hash()

      return e.constructor.name + '#' + e.position.x + '#' + e.position.y
    }
  }

  class BoundingBox {
    #position
    offset
    width
    height

    constructor(position, offset, width, height) {
      this.offset = offset
      this.#position = position.round().add(offset)
      this.width = width
      this.height = height
    }

    set position(position) {
      this.#position = position.round().add(this.offset)
    }

    get position() {
      return this.#position
    }

    collides(box2) {
      let position1 = this.position.round()
      let position2 = box2.position.round()

      return position1.x < position2.x + box2.width &&
        position1.x + this.width > position2.x &&
        position1.y < position2.y + box2.height &&
        position1.y + this.height > position2.y
    }
  }

  class Sprite {
    #name
    timestamp
    fps

    constructor(name, fps) {
      this.#name = name
      this.timestamp = performance.now()
      this.fps = fps || 10
    }

    set name(name) {
      if (this.#name != name) {
        this.#name = name
        this.timestamp = performance.now()
      }
    }

    get name() {
      return this.#name
    }
  }
  class DynamicEntity {
    _position
    _direction = Point.DOWN
    _velocity = 0
    sprite
    collisionShape
    zindex = 0

    constructor(position) {
      this._position = position
      this.update()

      // extending class must provide collisionShape and sprite
    }

    get position() {
      return this._position
    }

    set position(position) {
      this._position = position
      this.collisionShape.position = position
    }

    get direction() {
      return this._direction
    }

    set direction(direction) {
      this._direction = direction
      this.update()
    }

    get velocity() {
      return this._velocity
    }

    set velocity(velocity) {
      this._velocity = velocity
      this.update()
    }

    update() { }
  }

  class StaticEntity {
    position
    sprite
    collisionShape
    zindex = 0

    constructor(position, sprite, collisionShape) {
      this.position = position
      this.sprite = sprite
      this.collisionShape = collisionShape
    }
  }

  // internal state
  let imagePromises = []
  let spritePromises = []
  let definedSprites = []
  let keyHandlers = new Map()
  let clickHandlers = new Map()
  let bgCanvas
  let gameCanvas
  let oldTimestamp = performance.now()
  let requestAnimationFrameId
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
      if (ctx.keys[e.key]) return

      let key = keyHandlers.has(e.key) ? e.key : 'any'
      keyUpEvent = keyHandlers.get(key)

      ctx.keys[e.key] = true
    })

    window.addEventListener('keyup', e => {
      if (keyUpEvent) {
        keyUpEvent.callback()
        keyUpEvent = null
      }

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

  function runPhysics({ entities }) {
    Object.entries(entities).forEach(([key, entity]) => {
      if (entity instanceof DynamicEntity && entity.collisionShape && entity.velocity > 0) {
        let { position: ePos, width: eWidth, height: eHeight } = entity.collisionShape
        let resX = ePos.x, resY = ePos.y
        Object.entries(entities).forEach(([otherKey, otherEntity]) => {
          if (otherEntity.collisionShape &&
            key != otherKey &&
            entity.collisionShape.collides(otherEntity.collisionShape)) {
            let { position: oPos, width: oWidth, height: oHeight } = otherEntity.collisionShape

            if (entity.direction.y < 0) resY = oPos.y + oHeight
            else if (entity.direction.y > 0) resY = oPos.y - eHeight

            if (entity.direction.x < 0) resX = oPos.x + oWidth
            else if (entity.direction.x > 0) resX = oPos.x - eWidth

          }
        })
        entity.position = Point.at(resX, resY).subtract(entity.collisionShape.offset)
      }
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

  function drawScene(scene) {
    clearScreen()
    Object.values(
      scene.entities
    ).toSorted(
      (e1, e2) => e1.zindex - e2.zindex
    ).forEach(
      entity => drawEntity(entity)
    )
  }

  function drawEntity({ position, sprite }) {
    if (sprite instanceof Function) {
      sprite(position.round())
    } else {
      let { x, y } = position.round()
      let sprites = ctx.sprites[sprite.name]
      let spriteFrame

      if (sprites instanceof Array) {
        let msPerFrame = 1000 / sprite.fps
        let frame = Math.floor(((performance.now() - sprite.timestamp) / msPerFrame)) % sprites.length
        spriteFrame = sprites[frame]
      } else {
        spriteFrame = sprites
      }

      ctx.gameContext.drawImage(spriteFrame, x, y)
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
    HashSet,
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
    sendSignal,

    // Public context
    ctx
  }
})()