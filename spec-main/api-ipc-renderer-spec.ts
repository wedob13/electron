import { expect } from 'chai'
import * as path from 'path'
import { ipcMain, BrowserWindow, WebContents, WebPreferences, webContents } from 'electron'
import { emittedOnce } from './events-helpers'
import { closeWindow } from './window-helpers';

describe('ipcRenderer module', () => {
  const fixtures = path.join(__dirname, '..', 'spec', 'fixtures')

  let w: BrowserWindow
  before(async () => {
    w = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true } })
    await w.loadURL('about:blank')
  })
  after(async () => {
    await closeWindow(w)
    w = null as unknown as BrowserWindow
  })

  describe('send()', () => {
    it('should work when sending an object containing id property', async () => {
      const obj = {
        id: 1,
        name: 'ly'
      }
      w.webContents.executeJavaScript(`{
        const { ipcRenderer } = require('electron')
        ipcRenderer.send('message', ${JSON.stringify(obj)})
      }`)
      const [, received] = await emittedOnce(ipcMain, 'message')
      expect(received).to.deep.equal(obj)
    })

    it('can send instances of Date as ISO strings', async () => {
      const isoDate = new Date().toISOString()
      w.webContents.executeJavaScript(`{
        const { ipcRenderer } = require('electron')
        ipcRenderer.send('message', new Date(${JSON.stringify(isoDate)}))
      }`)
      const [, received] = await emittedOnce(ipcMain, 'message')
      expect(received).to.equal(isoDate)
    })

    it('can send instances of Buffer', async () => {
      const data = 'hello'
      w.webContents.executeJavaScript(`{
        const { ipcRenderer } = require('electron')
        ipcRenderer.send('message', Buffer.from(${JSON.stringify(data)}))
      }`)
      const [, received] = await emittedOnce(ipcMain, 'message')
      expect(received).to.be.an.instanceOf(Buffer)
      expect(Buffer.from(data).equals(received)).to.be.true()
    })

    it('can send objects with DOM class prototypes', async () => {
      w.webContents.executeJavaScript(`{
        const { ipcRenderer } = require('electron')
        ipcRenderer.send('message', document.location)
      }`)
      const [, value] = await emittedOnce(ipcMain, 'message')
      expect(value.protocol).to.equal('about:')
      expect(value.hostname).to.equal('')
    })

    it('does not crash on external objects (regression)', async () => {
      w.webContents.executeJavaScript(`{
        const { ipcRenderer } = require('electron')
        const http = require('http')

        const request = http.request({ port: 5000, hostname: '127.0.0.1', method: 'GET', path: '/' })
        const stream = request.agent.sockets['127.0.0.1:5000:'][0]._handle._externalStream
        request.on('error', () => {})

        ipcRenderer.send('message', request, stream)
      }`)
      const [, requestValue, externalStreamValue] = await emittedOnce(ipcMain, 'message')

      expect(requestValue.method).to.equal('GET')
      expect(requestValue.path).to.equal('/')
      expect(externalStreamValue).to.be.null()
    })

    it('can send objects that both reference the same object', async () => {
      w.webContents.executeJavaScript(`{
        const { ipcRenderer } = require('electron')
        
        const child = { hello: 'world' }
        const foo = { name: 'foo', child: child }
        const bar = { name: 'bar', child: child }
        const array = [foo, bar]

        ipcRenderer.send('message', array, foo, bar, child)
      }`)

      const child = { hello: 'world' }
      const foo = { name: 'foo', child: child }
      const bar = { name: 'bar', child: child }
      const array = [foo, bar]

      const [, arrayValue, fooValue, barValue, childValue] = await emittedOnce(ipcMain, 'message')
      expect(arrayValue).to.deep.equal(array)
      expect(fooValue).to.deep.equal(foo)
      expect(barValue).to.deep.equal(bar)
      expect(childValue).to.deep.equal(child)
    })

    it('inserts null for cyclic references', async () => {
      w.webContents.executeJavaScript(`{
        const { ipcRenderer } = require('electron')
        const array = [5]
        array.push(array)

        const child = { hello: 'world' }
        child.child = child
        ipcRenderer.send('message', array, child)
      }`)

      const [, arrayValue, childValue] = await emittedOnce(ipcMain, 'message')
      expect(arrayValue[0]).to.equal(5)
      expect(arrayValue[1]).to.be.null()

      expect(childValue.hello).to.equal('world')
      expect(childValue.child).to.be.null()
    })
  })

  describe('sendSync()', () => {
    it('can be replied to by setting event.returnValue', async () => {
      ipcMain.once('echo', (event, msg) => {
        event.returnValue = msg
      })
      const msg = await w.webContents.executeJavaScript(`new Promise(resolve => {
        const { ipcRenderer } = require('electron')
        resolve(ipcRenderer.sendSync('echo', 'test'))
      })`)
      expect(msg).to.equal('test')
    })
  })

  describe('sendTo()', () => {
    const generateSpecs = (description: string, webPreferences: WebPreferences) => {
      describe(description, () => {
        let contents: WebContents
        const payload = 'Hello World!'

        before(async () => {
          contents = (webContents as any).create({
            preload: path.join(fixtures, 'module', 'preload-ipc-ping-pong.js'),
            ...webPreferences
          })

          await contents.loadURL('about:blank')
        })

        after(() => {
          (contents as any).destroy()
          contents = null as unknown as WebContents
        })

        it('sends message to WebContents', async () => {
          const data = await w.webContents.executeJavaScript(`new Promise(resolve => {
            const { ipcRenderer } = require('electron')
            ipcRenderer.sendTo(${contents.id}, 'ping', ${JSON.stringify(payload)})
            ipcRenderer.once('pong', (event, data) => resolve(data))
          })`)
          expect(data).to.equal(payload)
        })

        it('sends message on channel with non-ASCII characters to WebContents', async () => {
          const data = await w.webContents.executeJavaScript(`new Promise(resolve => {
            const { ipcRenderer } = require('electron')
            ipcRenderer.sendTo(${contents.id}, 'ping-æøåü', ${JSON.stringify(payload)})
            ipcRenderer.once('pong-æøåü', (event, data) => resolve(data))
          })`)
          expect(data).to.equal(payload)
        })
      })
    }

    generateSpecs('without sandbox', {})
    generateSpecs('with sandbox', { sandbox: true })
    generateSpecs('with contextIsolation', { contextIsolation: true })
    generateSpecs('with contextIsolation + sandbox', { contextIsolation: true, sandbox: true })
  })
  /*

  */

  describe('ipcRenderer.on', () => {
    it('is not used for internals', async () => {
      const result = await w.webContents.executeJavaScript(`
        require('electron').ipcRenderer.eventNames()
      `)
      expect(result).to.deep.equal([])
    })
  })
})
