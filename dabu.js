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
      let x = 0.70, y = 0.70

      if (this.x == 0 || this.y == 0) {
        x = 1
        y = 1
      }

      return Point.at(Math.sign(this.x) * x, Math.sign(this.y) * x)
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
    cameraVelocity = 0
    cameraDirection = Point.DOWN
    cameraSubject
    // IMPORTANT: camera margins must allow for at least 1 pixel extra
    // on each axis of biggest entity subject to avoid smoothness issues
    cameraMarginH = 0
    cameraMarginV = 0
    cameraLastOrigin = Point.at(0, 0)
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
    lastDrawPosition
    previousPosition
    previousDirection = Point.DOWN
    _position
    width
    height
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
      this.lastDrawPosition = position
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
      this.update()
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

    // called on every position, direction and velocity change
    update() { }

    // called once per frame just before drawing the scene
    // but _after_ any movement smoothing
    updateAfter() {
      if (!this._position.equals(this.previousPosition)) {
        this.previousPosition = this._position
      }

      if (!this._direction.equals(this.previousDirection)) {
        this.previousDirection = this._direction
      }
    }
  }

  class StaticEntity {
    hash
    position
    width
    height
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
  let gamePixel;
  let gamePixelData;
  let bgPixel;
  let bgPixelData;

  // public state context
  let ctx = {
    width: null,
    height: null,
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

    ctx.width = width
    ctx.height = height

    ctx.bgContext = bgCanvas.getContext('2d')
    ctx.bgContext.imageSmoothingEnabled = false
    bgPixel = ctx.bgContext.createImageData(1, 1)
    bgPixelData = bgPixel.data
    ctx.gameContext = gameCanvas.getContext('2d')
    ctx.gameContext.imageSmoothingEnabled = false
    gamePixel = ctx.gameContext.createImageData(1, 1)
    gamePixelData = gamePixel.data
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
    opts = opts || {}
    updateCamera(scene)

    // must be set *after* updateCamera
    opts.cameraVelocity = scene.cameraVelocity
    opts.cameraDirection = scene.cameraDirection
    opts.cameraLastOrigin = scene.cameraLastOrigin

    clearScreen()
    Object.values(
      scene.entities
    ).toSorted(
      (e1, e2) => e1.zindex - e2.zindex
    ).forEach(
      entity => drawEntity(scene.cameraOrigin, entity, opts)
    )
  }

  function updateCamera(scene) {
    scene.cameraLastOrigin = scene.cameraOrigin

    let subject = scene.entities[scene.cameraSubject]

    if (subject && subject instanceof DynamicEntity) {
      scene.cameraDirection = subject.direction

      let { x: originX, y: originY } = scene.cameraOrigin
      let { x, y } = subject.position.round()

      // diagonal movement smoothing
      if (subject.direction.x != 0 && subject.direction.y != 0) {
        let deltaX = Math.abs(x - subject.lastDrawPosition.x)
        let deltaY = Math.abs(y - subject.lastDrawPosition.y)
        if (deltaX <= 1 && deltaY <= 1 && deltaX != deltaY) {
          x = subject.lastDrawPosition.x
          y = subject.lastDrawPosition.y
        }
      }

      let screenX = x - originX
      let screenY = y - originY

      let newVelocity = 0
      let newX = originX
      let newY = originY

      if (screenX <= scene.cameraMarginH) {
        if (subject.direction.x < 0) {
          newVelocity = subject.velocity
        }
        newVelocity = subject.velocity
        newX = x - scene.cameraMarginH
      } else if (screenX + subject.width >= ctx.width - scene.cameraMarginH) {
        if (subject.direction.x > 0) {
          newVelocity = subject.velocity
        }
        newVelocity = subject.velocity
        newX = (x + subject.width) - ctx.width + scene.cameraMarginH
      }

      if (screenY <= scene.cameraMarginV) {
        if (subject.direction.y < 0) {
          newVelocity = subject.velocity
        }
        newY = y - scene.cameraMarginV
      } else if (screenY + subject.height >= ctx.height - scene.cameraMarginV) {
        if (subject.direction.y > 0) {
          newVelocity = subject.velocity
        }
        newY = (y + subject.height) - ctx.height + scene.cameraMarginV
      }

      scene.cameraVelocity = newVelocity
      scene.cameraOrigin = Point.at(newX, newY)
    } else if (subject && subject instanceof StaticEntity) {
      scene.cameraOrigin = Point.at(
        subject.position.x - (ctx.width - subject.width) / 2,
        subject.position.y - (ctx.height - subject.height) / 2
      )
    }
  }

  function drawEntity(origin, entity, opts) {
    let drawPosition

    let position = entity.position.round()

    // Smoothening out diagonal movement, if enabled.
    // Works only if entities move along ideal diagonals
    if (entity instanceof DynamicEntity &&
      opts.pixelPerfectMovement &&
      opts.smoothDiagonalMovement &&
      entity.velocity > 0 &&
      entity.direction.x != 0 &&
      entity.direction.y != 0) {
      let deltaX = Math.abs(position.x - entity.lastDrawPosition.x)
      let deltaY = Math.abs(position.y - entity.lastDrawPosition.y)
      if (deltaX <= 1 && deltaY <= 1 && deltaX != deltaY) {
        drawPosition = entity.lastDrawPosition
      } else {
        drawPosition = position
      }
    } else {
      drawPosition = position
    }

    // Smoothening entity movement relative to moving camera
    if (entity instanceof DynamicEntity &&
      opts.pixelPerfectMovement &&
      opts.cameraVelocity > 0 &&
      entity.velocity > 0 &&
      (entity.velocity != opts.cameraVelocity ||
        !entity.direction.equals(opts.cameraDirection))) {
      let previousScreenPosition = entity.lastDrawPosition.subtract(opts.cameraLastOrigin)
      let currentScreenPosition = drawPosition.subtract(origin)
      let screenDelta = currentScreenPosition.subtract(previousScreenPosition)
      let cameraDirectionX = opts.cameraDirection.x
      let cameraDirectionY = opts.cameraDirection.y
      let entityDirectionX = entity.direction.x
      let entityDirectionY = entity.direction.y

      if ((cameraDirectionX != 0 && Math.sign(cameraDirectionX) == Math.sign(entityDirectionX)) ||
        (cameraDirectionY != 0 && Math.sign(cameraDirectionY) == Math.sign(entityDirectionY))) {
        let cameraVelocityX = Math.abs(cameraDirectionX * opts.cameraVelocity)
        let cameraVelocityY = Math.abs(cameraDirectionY * opts.cameraVelocity)
        let entityVelocityX = Math.abs(entityDirectionX * entity.velocity)
        let entityVelocityY = Math.abs(entityDirectionY * entity.velocity)

        if (cameraVelocityX > entityVelocityX && Math.sign(screenDelta.x) == Math.sign(cameraDirectionX)) {
          // entity moving forward relative to camera when it shouldn't
          drawPosition.x = drawPosition.x - Math.sign(screenDelta.x)
        } else if (cameraVelocityX < entityVelocityX && Math.sign(screenDelta.x) == -1 * Math.sign(cameraDirectionX)) {
          // entity moving backward relative to camera when it shouldn't
          drawPosition.x = drawPosition.x - Math.sign(screenDelta.x)
        }

        if (cameraVelocityY > entityVelocityY && Math.sign(screenDelta.y) == Math.sign(cameraDirectionY)) {
          // entity moving forward relative to camera when it shouldn't
          drawPosition.y = drawPosition.y - Math.sign(screenDelta.y)
        } else if (cameraVelocityY < entityVelocityY && Math.sign(screenDelta.y) == -1 * Math.sign(cameraDirectionY)) {
          // entity moving backward relative to camera when it shouldn't
          drawPosition.y = drawPosition.y - Math.sign(screenDelta.y)
        }
      }
    }

    if (entity instanceof DynamicEntity) {
      entity.lastDrawPosition = drawPosition
      entity.updateAfter()
    }

    let sprite = entity.sprite

    if (sprite instanceof Function) {
      sprite(drawPosition.subtract(origin), entity.direction, entity.velocity)
    } else {
      let { x, y } = drawPosition.subtract(origin)
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

      if (opts && opts.drawTraces && entity instanceof DynamicEntity) {
        drawBgPixel(x, y, 120, 120, 120)
      }

      ctx.gameContext.drawImage(spriteFrame, x, y)

      if (entity.collisionShape && opts && opts.drawCollisionShapes) {
        let { position, width, height } = entity.collisionShape
        let shapePosition = position.subtract(origin).round()
        drawPerfectGameRect(shapePosition.x, shapePosition.y, width, height, 0, 200, 0)
      }

      if (entity.hitShape && opts && opts.drawHitShapes) {
        let { position, width, height } = entity.hitShape
        let shapePosition = position.subtract(origin).round()
        drawPerfectGameRect(shapePosition.x, shapePosition.y, width, height, 200, 0, 0)
      }
    }
  }

  function drawPerfectGameRect(sx, sy, width, height, r, g, b) {
    let left = sx
    let right = sx + width - 1
    let top = sy
    let bottom = sy + height - 1
    for (let x = left; x <= right; x++) {
      for (let y = top; y <= bottom; y++) {
        if (y == top || y == bottom || x == left || x == right) {
          drawGamePixel(x, y, r, g, b)
        }
      }
    }
  }

  function drawGamePixel(x, y, r, g, b) {
    gamePixelData[0] = r
    gamePixelData[1] = g
    gamePixelData[2] = b
    gamePixelData[3] = 255
    ctx.gameContext.putImageData(gamePixel, x, y)
  }

  function drawBgPixel(x, y, r, g, b) {
    bgPixelData[0] = r
    bgPixelData[1] = g
    bgPixelData[2] = b
    bgPixelData[3] = 255
    ctx.bgContext.putImageData(bgPixel, x, y)
  }

  function sendSignal(name, arg) {
    if (ctx.signals[name]) {
      ctx.signals[name].push(arg)
    } else {
      ctx.signals[name] = [arg]
    }
  }

  function sample(list) {
    return list[Math.floor((Math.random() * list.length))];
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
    sample,

    // Public context
    ctx
  }
})()