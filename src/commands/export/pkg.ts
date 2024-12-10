/**
 * ./src/commands/export/deb.ts
 * penguins-eggs v.10.0.0 / ecmascript 2020
 * author: Piero Proietti
 * email: piero.proietti@gmail.com
 * license: MIT
 */

import { Command, Flags } from '@oclif/core'

import Distro from '../../classes/distro.js'
import Diversions from '../../classes/diversions.js'
import Tools from '../../classes/tools.js'
import Utils from '../../classes/utils.js'
import { exec } from '../../lib/utils.js'
import os from 'node:os'

import { IEggsConfigTools } from '../../interfaces/i-config-tools.js'
import { execSync } from 'node:child_process'

export default class ExportPkg extends Command {
  static description = 'export pkg/iso to the destination host'

  static examples = ['eggs export pkg', 'eggs export pkg --clean', 'eggs export pkg --all']

  static flags = {
    all: Flags.boolean({ char: 'a', description: 'export all archs' }),
    clean: Flags.boolean({ char: 'c', description: 'remove old .deb before to copy' }),
    help: Flags.help({ char: 'h' }),
    verbose: Flags.boolean({ char: 'v', description: 'verbose' })
  }

  user = ''

  all = false

  clean = false

  verbose = false

  echo = {}

  Tu = new Tools()

  /**
   * 
   */
  async run(): Promise<void> {
    const { args, flags } = await this.parse(ExportPkg)
    Utils.titles(this.id + ' ' + this.argv)
    Utils.warning(ExportPkg.description)

    // Ora servono in più parti
    this.user = os.userInfo().username
    if (this.user === 'root') {
      this.user = execSync('echo $SUDO_USER', { encoding: 'utf-8' }).trim()
      if (this.user === '') {
        this.user = execSync('echo $DOAS_USER', { encoding: 'utf-8' }).trim()
      }
    }
    this.all = flags.all
    this.clean = flags.clean
    this.verbose = flags.verbose
    this.echo = Utils.setEcho(this.verbose)
    await this.Tu.loadSettings()

    let distro = new Distro()
    const familyId = distro.familyId
    const distroId = distro.distroId
    const remoteMountpoint = `/tmp/eggs-${(Math.random() + 1).toString(36).slice(7)}`

    let localPath = ''
    let remotePath = ''
    let filter = ''

    /**
     * aldos
     */
    if (familyId === 'aldos') {
      Utils.warning("aldos rpm")
      process.exit()

      /**
       * alpine
       */
    } else if (familyId === 'alpine') {
      Utils.warning("alpine apk")
      let arch = 'x86_64'
      if (process.arch === 'ia32') {
        arch = 'i386'
      }
      localPath = `/home/${this.user}/packages/alpine/${arch}`
      remotePath = `${this.Tu.config.remotePathPackages}/alpine/`
      filter = `penguins-eggs*10.?.*-r*.apk`

      /**
       * Arch/Manjaro 
       */
    } else if (familyId === 'archlinux') {

      /**
       * Manjaro
       */
      if (Diversions.isManjaroBased(distroId)) {
        Utils.warning("manjaro PKGBUILD")
        localPath = `/home/${this.user}/penguins-packs/manjaro/penguins-eggs`
        remotePath = this.Tu.config.remotePathPackages + "/manjaro"
        filter = `penguins-eggs-10.?.*-?-any.pkg.tar.*`

        /**
         * Arch
         */
      } else {
        Utils.warning("aur PKGBUILD")
        localPath = `/home/${this.user}/penguins-packs/aur/penguins-eggs`
        remotePath = this.Tu.config.remotePathPackages + "/aur"
        filter = `penguins-eggs-10.?.*-?-any.pkg.tar.zst`
      }

      /**
       * Debian
       */
    } else if (familyId === "debian") {
      Utils.warning("debian deb")
      localPath = `/home/${this.user}/penguins-eggs/perrisbrewery/workdir`
      remotePath = this.Tu.config.remotePathPackages + "/debs"
      let arch = Utils.uefiArch()
      if (this.all) {
        arch = '*'
      }
      filter = `penguins-eggs_10.?.*-?_${arch}.deb`

      /**
       * fedora
       */
    } else if (familyId === 'fedora') {
      Utils.warning("fedora rpm packages")
      localPath = `/home/${this.user}/rpmbuild/RPMS/x86_64`
      remotePath = this.Tu.config.remotePathPackages + "/fedora"
      filter = `penguins-eggs-10.?.*-?fedora.*.rpm`

      /**
       * openmamba
       */
    } else if (familyId === 'openmamba') {
      Utils.warning("openmamba rpm packages")
      localPath = `/usr/src/RPM/RPMS/x86_64`

      remotePath = this.Tu.config.remotePathPackages + "/openmamba"
      filter = `penguins-eggs-10.?.*-?mamba.*.rpm`

      /**
       * opensuse
       */
    } else if (familyId === 'opensuse') {
      Utils.warning("opensuse rpm packages")
      process.exit()

      /**
       * voidlinux
       */
    } else if (familyId === 'voidlinux') {
      Utils.warning("voidlinux packages")
      process.exit()
    }

    let cmd = `mkdir ${remoteMountpoint}\n`
    cmd += `sshfs ${this.Tu.config.remoteUser}@${this.Tu.config.remoteHost}:${remotePath} ${remoteMountpoint}\n`
    if (this.clean) {
      cmd += `rm -f ${remoteMountpoint}/${filter}\n`
    }

    cmd += `cp ${localPath}/${filter} ${remoteMountpoint}\n`
    cmd += 'sync\n'
    cmd += `umount ${remoteMountpoint}\n`
    cmd += `rm -rf ${remoteMountpoint}\n`
    if (!this.verbose) {
      if (this.clean) {
        console.log(`remove: ${this.Tu.config.remoteUser}@${this.Tu.config.remoteHost}:${filter}`)
      }
      console.log(`copy: ${localPath}/${filter} to ${this.Tu.config.remoteUser}@${this.Tu.config.remoteHost}:${remotePath}`)
    }
    await exec(cmd, this.echo)
  }
}

