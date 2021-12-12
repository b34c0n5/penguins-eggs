/* eslint-disable valid-jsdoc */
/* eslint-disable no-console */

/**
 * penguins-eggs: ovary.ts
 * author: Piero Proietti
 * mail: piero.proietti@gmail.com
 *
 */

// packages
import fs = require('fs')
import path = require('path')
import os = require('os')
import shx = require('shelljs')

import chalk from 'chalk'
import mustache from 'mustache'

import PveLive from './pve-live'

// interfaces
import { IMyAddons } from '../interfaces'

// libraries
const exec = require('../lib/utils').exec

// classes
import Utils from './utils'
import N8 from './n8'
import Incubator from './incubation/incubator'
import Xdg from './xdg'
import Pacman from './pacman'
import Settings from './settings'
import Systemctl from './systemctl'
import Bleach from './bleach'
import Repo from './yolk'
import cliAutologin = require('../lib/cli-autologin')
import { execSync } from 'child_process'


/**
 * Ovary:
 */
export default class Ovary {

   toNull = ' > /dev/null 2>&1'

   incubator = {} as Incubator

   settings = {} as Settings

   snapshot_prefix = ''

   snapshot_basename = ''

   theme = ''

   compression = ''

   /**
    * Egg
    * @param compression
    */
   constructor(snapshot_prefix = '', snapshot_basename = '', theme = '', compression = '') {
      this.settings = new Settings()


      // I flags di produce hanno la preferenza
      if (snapshot_prefix !== '') {
         this.snapshot_prefix = snapshot_prefix
      }
      if (snapshot_basename !== '') {
         this.snapshot_basename = snapshot_basename
      }
      if (theme !== '') {
         this.theme = theme
      }
      if (compression !== '') {
         this.compression = compression
      }

   }

   /**
    * @returns {boolean} success
    */
   async fertilization(): Promise<boolean> {
      if (await this.settings.load()) {
         if (this.snapshot_prefix !== '') {
            this.settings.config.snapshot_prefix = this.snapshot_prefix
         }

         if (this.snapshot_basename !== '') {
            this.settings.config.snapshot_basename = this.snapshot_basename
         }

         if (this.theme !== '') {
            this.settings.config.theme = this.theme
         }

         if (this.compression !== '') {
            this.settings.config.compression = this.compression
         }


         this.settings.listFreeSpace()
         if (await Utils.customConfirm('Select yes to continue...')) return true
      }
      return false
   }

   /**
    *
    * @param basename
    */
   async produce(backup = false, scriptOnly = false, yolkRenew = false, release = false, myAddons: IMyAddons, verbose = false) {

      if (Pacman.distro().familyId === 'debian') {
         const yolk = new Repo()
         if (!yolk.exists()) {
            Utils.warning('local repo yolk creation...')
            await yolk.create(verbose)
         } else {
            if (yolkRenew) {
               Utils.warning('force renew local repository yolk...')
               yolk.clean()
               await yolk.create(verbose)
            } else {
               Utils.warning('Using preesixent yolk...')
            }
         }
      }

      if (!fs.existsSync(this.settings.config.snapshot_dir)) {
         shx.mkdir('-p', this.settings.config.snapshot_dir)
      }

      await this.settings.loadRemix(this.snapshot_basename, this.theme)

      if (Utils.isLive()) {
         console.log(chalk.red('>>> eggs: This is a live system! An egg cannot be produced from an egg!'))
      } else {
         if (verbose) {
            console.log(`egg ${this.settings.remix.name}`)
         }

         await this.liveCreateStructure(verbose)

         if (Pacman.distro().isCalamaresAvailable && await Pacman.isInstalledGui()) {
            if (this.settings.config.force_installer && !(await Pacman.calamaresCheck())) {
               console.log('Installing ' + chalk.bgGray('calamares') + ' due force_installer=yes.')
               await Pacman.calamaresInstall(verbose)
               const bleach = new Bleach
               await bleach.clean(verbose)
            }
         }

         /**
          * Anche non accettando l'installazione di calamares
          * viene creata la configurazione dell'installer: krill/calamares
          * L'installer prende il tema da settings.remix.branding
          */
         this.incubator = new Incubator(this.settings.remix, this.settings.distro, this.settings.config.user_opt, verbose)
         await this.incubator.config(release)

         await this.syslinux(verbose)
         if (Pacman.distro().familyId === 'debian') {
            await this.isolinux(this.theme, verbose)
         } else {
            await this.isolinux(this.theme, verbose)
         }


         await this.copyKernel(verbose)
         if (this.settings.config.make_efi) {
            await this.makeEfi(this.theme, verbose)
         }

         await this.bindLiveFs(verbose)
         await this.cleanUsersAccounts()
         await this.createUserLive(verbose)

         const displaymanager = require('./incubation/fisherman-helper/displaymanager').displaymanager
         if (Pacman.isInstalledGui()) {
            await this.createXdgAutostart(this.theme, myAddons)
            if (displaymanager() === '') {
               // If GUI is installed and not Desktop manager 
               cliAutologin.addIssue(this.settings.distro.distroId, this.settings.distro.versionId, this.settings.config.user_opt, this.settings.config.user_opt_passwd, this.settings.config.root_passwd, this.settings.work_dir.merged)
               cliAutologin.addMotd(this.settings.distro.distroId, this.settings.distro.versionId, this.settings.config.user_opt, this.settings.config.user_opt_passwd, this.settings.config.root_passwd, this.settings.work_dir.merged)
            }
         } else {
            cliAutologin.addAutologin(this.settings.distro.distroId, this.settings.distro.versionId, this.settings.config.user_opt, this.settings.config.user_opt_passwd, this.settings.config.root_passwd, this.settings.work_dir.merged)
         }

         await this.editLiveFs(verbose)
         await this.makeSquashfs(scriptOnly, verbose)
         await this.uBindLiveFs(verbose) // Lo smonto prima della fase di backup

         if (backup) {
            Utils.titles('produce --backup')
            Utils.warning('You will be prompted to give crucial informations to protect your users data')
            Utils.warning('I\'m calculatings users datas needs. Please wait...')

            const usersDataSize = await this.getUsersDatasSize(verbose) //  837,812,224  // 700 MB
            Utils.warning('User\'s data are: ' + Utils.formatBytes(usersDataSize))
            Utils.warning('Your passphrase will be not written in any way on the support, so it is literally unrecoverable.')

            const binaryHeaderSize = 4194304 // 4MB = 4,194,304 
            Utils.warning('We need additional space of : ' + Utils.formatBytes(binaryHeaderSize, 2))
            let volumeSize = usersDataSize + binaryHeaderSize
            const minimunSize = 33554432 // 32M = 33,554,432
            if (volumeSize < minimunSize) {
               volumeSize = minimunSize
            }

            /*
            if (volumeSize < 536870912) { // 512MB 536,870,912
               volumeSize *= 1.15 // add 15%
            } else if (volumeSize > 536870912 && (volumeSize < 1073741824)) { // 1GB 1,073,741,824
               volumeSize *= 1.10 // add 10%
            } else if (volumeSize > 1073741824) { // 1GB 1,073,741,824
               volumeSize *= 1.05 // add 10%
            }
            volumeSize += 1073741824 // add 1 GB
            */

            /**
             * C'è un problema di blocchi
             * sudo tune2fs -l /dev/sda1 | grep -i 'block size' = 4096 
             */

            Utils.warning('Creating volume luks-users-data of ' + Utils.formatBytes(volumeSize, 0))
            execSync('dd if=/dev/zero of=/tmp/luks-users-data bs=1 count=0 seek=' + Utils.formatBytes(volumeSize, 0) + this.toNull, { stdio: 'inherit' })

            Utils.warning('Formatting volume luks-users-data. You will insert a passphrase and confirm it')
            execSync('cryptsetup luksFormat /tmp/luks-users-data', { stdio: 'inherit' })

            Utils.warning('Opening volume luks-users-data and map it in /dev/mapper/eggs-users-data')
            Utils.warning('You will insert the same passphrase you choose before')
            execSync('cryptsetup luksOpen /tmp/luks-users-data eggs-users-data', { stdio: 'inherit' })

            Utils.warning('Formatting volume eggs-users-data with ext4')
            execSync('mkfs.ext2 /dev/mapper/eggs-users-data' + this.toNull, { stdio: 'inherit' })

            Utils.warning('mounting volume eggs-users-data in /mnt')
            execSync('mount /dev/mapper/eggs-users-data /mnt', { stdio: 'inherit' })

            Utils.warning('Saving users datas in eggs-users-data')
            await this.copyUsersDatas(verbose)

            const bytesUsed = parseInt(shx.exec(`du -b --summarize /mnt |awk '{ print $1 }'`, { silent: true }).stdout.trim())
            Utils.warning('We used ' + Utils.formatBytes(bytesUsed, 0) + ' on ' + Utils.formatBytes(volumeSize, 0) + ' in volume luks-users-data')

            Utils.warning('Unmount /mnt')
            execSync('umount /mnt', { stdio: 'inherit' })

            Utils.warning('closing eggs-users-data')
            execSync('cryptsetup luksClose eggs-users-data', { stdio: 'inherit' })

            Utils.warning('moving luks-users-data in ' + this.settings.config.snapshot_dir + 'ovarium/iso/live')
            execSync('mv /tmp/luks-users-data ' + this.settings.config.snapshot_dir + 'ovarium/iso/live', { stdio: 'inherit' })
         }

         let xorrisoCommand = this.makeDotDisk(backup, verbose)
         await this.makeIso(xorrisoCommand, backup, scriptOnly, verbose)
      }
   }


   /**
    * Crea la struttura della workdir
    */
   async liveCreateStructure(verbose = false) {
      if (verbose) {
         console.log('Overy: liveCreateStructure')
      }

      Utils.warning(`Creating egg in ${this.settings.work_dir.path}`)

      if (!fs.existsSync(this.settings.work_dir.path)) {
         try {
            shx.mkdir('-p', this.settings.work_dir.path)
         } catch (error) {
            console.log('error: ' + error + ' creating ' + this.settings.work_dir.path)
         }
      }

      if (!fs.existsSync(this.settings.work_dir.path + '/README.md')) {
         try {
            shx.cp(path.resolve(__dirname, '../../conf/README.md'), this.settings.work_dir.path + 'README.md')
         } catch (error) {
            console.log('error: ' + error + ' creating ' + path.resolve(__dirname, '../../conf/README.md'), this.settings.work_dir.path + 'README.md')
         }
      }

      if (!fs.existsSync(this.settings.work_dir.lowerdir)) {
         try {
            shx.mkdir('-p', this.settings.work_dir.lowerdir)
         } catch (error) {
            console.log('error: ' + error + ' creating ' + this.settings.work_dir.lowerdir)
         }
      }

      if (!fs.existsSync(this.settings.work_dir.upperdir)) {
         try {
            shx.mkdir('-p', this.settings.work_dir.upperdir)
         } catch (error) {
            console.log('error: ' + error + ' creating ' + this.settings.work_dir.upperdir)
         }
      }

      if (!fs.existsSync(this.settings.work_dir.workdir)) {
         try {
            shx.mkdir('-p', this.settings.work_dir.workdir)
         } catch (error) {
            console.log('error: ' + error + ' creating ' + this.settings.work_dir.workdir)
         }
      }

      if (!fs.existsSync(this.settings.work_dir.merged)) {
         try {
            shx.mkdir('-p', this.settings.work_dir.merged)
         } catch (error) {
            console.log('error: ' + error + ' creating ' + this.settings.work_dir.merged)
         }
      }

      /**
       * Creo le directory di destinazione per boot, efi, isolinux e live
       * precedentemente in isolinux
       */
      if (!fs.existsSync(this.settings.work_dir.pathIso)) {
         try {
            shx.mkdir('-p', this.settings.work_dir.pathIso + '/boot/grub/' + Utils.machineUEFI())
         } catch (error) {
            console.log('error: ' + error + ' creating ' + this.settings.work_dir.pathIso + '/boot/grub/' + Utils.machineUEFI())
         }

         try {
            shx.mkdir('-p', this.settings.work_dir.pathIso + '/efi/boot')
         } catch (error) {
            console.log('error: ' + error + ' creating ' + this.settings.work_dir.pathIso + '/efi/boot')
         }

         try {
            shx.mkdir('-p', this.settings.work_dir.pathIso + '/isolinux')
         } catch (error) {
            shx.mkdir('-p', this.settings.work_dir.pathIso + '/isolinux')
         }

         try {
            shx.mkdir('-p', this.settings.work_dir.pathIso + '/live')
         } catch (error) {
            shx.mkdir('-p', this.settings.work_dir.pathIso + '/live')
         }
      }
   }

   /**
    * editLiveFs
    * - Truncate logs, remove archived log
    * - Allow all fixed drives to be mounted with pmount
    * - Enable or disable password login trhough ssh for users (not root)
    * - Create an empty /etc/fstab
    * - Blanck /etc/machine-id
    * - Add some basic files to /dev
    * - Clear configs from /etc/network/interfaces, wicd and NetworkManager and netman
    */
   async editLiveFs(verbose = false) {
      const echo = Utils.setEcho(verbose)
      if (verbose) {
         console.log('ovary: editLiveFs')
      }

      if (Pacman.distro().familyId === 'debian') {
         // Aggiungo UMASK=0077 in /etc/initramfs-tools/conf.d/calamares-safe-initramfs.conf
         let text = 'UMASK=0077\n'
         let file = '/etc/initramfs-tools/conf.d/eggs-safe-initramfs.conf'
         Utils.write(file, text)
      }

      // sudo systemctl disable wpa_supplicant

      // Truncate logs, remove archived logs.
      let cmd = `find ${this.settings.work_dir.merged}/var/log -name "*gz" -print0 | xargs -0r rm -f`
      await exec(cmd, echo)
      cmd = `find ${this.settings.work_dir.merged}/var/log/ -type f -exec truncate -s 0 {} \\;`
      await exec(cmd, echo)

      // Allow all fixed drives to be mounted with pmount
      if (this.settings.config.pmount_fixed) {
         if (fs.existsSync(`${this.settings.work_dir.merged}/etc/pmount.allow`)) {
            // MX aggiunto /etc
            await exec(`sed -i 's:#/dev/sd\[a-z\]:/dev/sd\[a-z\]:' ${this.settings.work_dir.merged}/etc/pmount.allow`, echo)
         }
      }

      // Enable or disable password login through ssh for users (not root)
      // Remove obsolete live-config file
      if (fs.existsSync(`${this.settings.work_dir.merged}lib/live/config/1161-openssh-server`)) {
         await exec('rm -f "$work_dir"/myfs/lib/live/config/1161-openssh-server', echo)
      }
      if (fs.existsSync(`${this.settings.work_dir.merged}/etc/ssh/sshd_config`)) {
         await exec(`sed -i 's/PermitRootLogin yes/PermitRootLogin prohibit-password/' ${this.settings.work_dir.merged}/etc/ssh/sshd_config`, echo)
         if (this.settings.config.ssh_pass) {
            await exec(`sed -i 's|.*PasswordAuthentication.*no|PasswordAuthentication yes|' ${this.settings.work_dir.merged}/etc/ssh/sshd_config`, echo)
         } else {
            await exec(`sed -i 's|.*PasswordAuthentication.*yes|PasswordAuthentication no|' ${this.settings.work_dir.merged}/etc/ssh/sshd_config`, echo)
         }
      }

      /**
       * /etc/fstab should exist, even if it's empty,
       * to prevent error messages at boot
       */
      await exec(`rm ${this.settings.work_dir.merged}/etc/fstab`, echo)
      await exec(`touch ${this.settings.work_dir.merged}/etc/fstab`, echo)

      /**
       * Blank out systemd machine id. If it does not exist, systemd-journald
       * will fail, but if it exists and is empty, systemd will automatically
       * set up a new unique ID.
       */
      if (fs.existsSync(`${this.settings.work_dir.merged}/etc/machine-id`)) {
         await exec(`rm ${this.settings.work_dir.merged}/etc/machine-id`, echo)
         await exec(`touch ${this.settings.work_dir.merged}/etc/machine-id`, echo)
         Utils.write(`${this.settings.work_dir.merged}/etc/machine-id`, ':')
      }

      /**
       * LMDE4: utilizza UbuntuMono16.pf2
       * aggiungo un link a /boot/grub/fonts/UbuntuMono16.pf2
       */
      shx.cp(`${this.settings.work_dir.merged}/boot/grub/fonts/unicode.pf2`, `${this.settings.work_dir.merged}/boot/grub/fonts/UbuntuMono16.pf2`)

      /**
       * Per tutte le distro systemd
       */
      if (Utils.isSystemd()) {
         /**
          * SU UBUNTU E DERIVATE NON DISABILITARE systemd-resolved.service
          */
         if (this.settings.distro.distroLike !== 'Ubuntu') {
            await exec(`chroot ${this.settings.work_dir.merged} systemctl disable systemd-resolved.service`)
         }

         // systemctl is-enabled
         const systemdctl = new Systemctl()
         if (await systemdctl.isEnabled('systemd-networkd.service')) {
            await exec(`chroot ${this.settings.work_dir.merged} systemctl disable systemd-networkd.service`)
         }

         if (await systemdctl.isEnabled('remote-cryptsetup.target')) {
            await exec(`chroot ${this.settings.work_dir.merged} systemctl disable remote-cryptsetup.target`)
         }

         if (await systemdctl.isEnabled('speech-dispatcherd.service')) {
            await exec(`chroot ${this.settings.work_dir.merged} systemctl disable speech-dispatcherd.service`)
         }

         if (await systemdctl.isEnabled('wpa_supplicant-nl80211@.service')) {
            await exec(`chroot ${this.settings.work_dir.merged} systemctl disable wpa_supplicant-nl80211@.service`)
         }
         if (await systemdctl.isEnabled('wpa_supplicant@.service')) {
            await exec(`chroot ${this.settings.work_dir.merged} systemctl disable wpa_supplicant@.service`)
         }

         if (await systemdctl.isEnabled('wpa_supplicant-wired@.service')) {
            await exec(`chroot ${this.settings.work_dir.merged} systemctl disable wpa_supplicant-wired@.service`)
         }
      }

      // Probabilmente non necessario
      // shx.touch(`${this.settings.work_dir.merged}/etc/resolv.conf`)

      /**
       * Clear configs from /etc/network/interfaces, wicd and NetworkManager
       * and netman, so they aren't stealthily included in the snapshot.
       */
      if (Pacman.distro().familyId === 'debian') {
         if (fs.existsSync(`${this.settings.work_dir.merged}/etc/network/interfaces`)) {
            await exec(`rm ${this.settings.work_dir.merged}/etc/network/interfaces`, echo)
         }
         await exec(`touch ${this.settings.work_dir.merged}/etc/network/interfaces`, echo)
         Utils.write(`${this.settings.work_dir.merged}/etc/network/interfaces`, 'auto lo\niface lo inet loopback')
      }

      /**
       * Per tutte le distro systemd
       */
      if (Utils.isSystemd()) {
         await exec(`rm -f ${this.settings.work_dir.merged}/var/lib/wicd/configurations/*`, echo)
         await exec(`rm -f ${this.settings.work_dir.merged}/etc/wicd/wireless-settings.conf`, echo)
         await exec(`rm -f ${this.settings.work_dir.merged}/etc/NetworkManager/system-connections/*`, echo)
         await exec(`rm -f ${this.settings.work_dir.merged}/etc/network/wifi/*`, echo)
         /**
          * Andiamo a fare pulizia in /etc/network/:
          * if-down.d  if-post-down.d  if-pre-up.d  if-up.d  interfaces  interfaces.d
          */
         const cleanDirs = ['if-down.d', 'if-post-down.d', 'if-pre-up.d', 'if-up.d', 'interfaces.d']
         let cleanDir = ''
         for (cleanDir of cleanDirs) {
            await exec(`rm -f ${this.settings.work_dir.merged}/etc/network/${cleanDir}/wpasupplicant`, echo)
         }
      }

      /**
       * add some basic files to /dev
       */
      if (!fs.existsSync(`${this.settings.work_dir.merged}/dev/console`)) {
         await exec(`mknod -m 622 ${this.settings.work_dir.merged}/dev/console c 5 1`, echo)
      }
      if (!fs.existsSync(`${this.settings.work_dir.merged}/dev/null`)) {
         await exec(`mknod -m 666 ${this.settings.work_dir.merged}/dev/null c 1 3`, echo)
      }
      if (!fs.existsSync(`${this.settings.work_dir.merged}/dev/zero`)) {
         await exec(`mknod -m 666 ${this.settings.work_dir.merged}/dev/zero c 1 5`, echo)
      }
      if (!fs.existsSync(`${this.settings.work_dir.merged}/dev/ptmx`)) {
         await exec(`mknod -m 666 ${this.settings.work_dir.merged}/dev/ptmx c 5 2`, echo)
      }
      if (!fs.existsSync(`${this.settings.work_dir.merged}/dev/tty`)) {
         await exec(`mknod -m 666 ${this.settings.work_dir.merged}/dev/tty c 5 0`, echo)
      }
      if (!fs.existsSync(`${this.settings.work_dir.merged}/dev/random`)) {
         await exec(`mknod -m 444 ${this.settings.work_dir.merged}/dev/random c 1 8`, echo)
      }
      if (!fs.existsSync(`${this.settings.work_dir.merged}/dev/urandom`)) {
         await exec(`mknod -m 444 ${this.settings.work_dir.merged}/dev/urandom c 1 9`, echo)
      }
      if (!fs.existsSync(`${this.settings.work_dir.merged}/dev/{console,ptmx,tty}`)) {
         await exec(`chown -v root:tty ${this.settings.work_dir.merged}/dev/{console,ptmx,tty}`, echo)
      }
      if (!fs.existsSync(`${this.settings.work_dir.merged}/dev/fd`)) {
         await exec(`ln -sv /proc/self/fd ${this.settings.work_dir.merged}/dev/fd`, echo)
      }
      if (!fs.existsSync(`${this.settings.work_dir.merged}/dev/stdin`)) {
         await exec(`ln -sv /proc/self/fd/0 ${this.settings.work_dir.merged}/dev/stdin`, echo)
      }
      if (!fs.existsSync(`${this.settings.work_dir.merged}/dev/stdout`)) {
         await exec(`ln -sv /proc/self/fd/1 ${this.settings.work_dir.merged}/dev/stdout`, echo)
      }
      if (!fs.existsSync(`${this.settings.work_dir.merged}/dev/stderr`)) {
         await exec(`ln -sv /proc/self/fd/2 ${this.settings.work_dir.merged}/dev/stderr`, echo)
      }
      if (!fs.existsSync(`${this.settings.work_dir.merged}/dev/core`)) {
         await exec(`ln -sv /proc/kcore ${this.settings.work_dir.merged}/dev/core`, echo)
      }
      if (!fs.existsSync(`${this.settings.work_dir.merged}/dev/shm`)) {
         await exec(`mkdir -v ${this.settings.work_dir.merged}/dev/shm`, echo)
      }
      if (!fs.existsSync(`${this.settings.work_dir.merged}/dev/pts`)) {
         await exec(`mkdir -v ${this.settings.work_dir.merged}/dev/pts`, echo)
      }
      if (!fs.existsSync(`${this.settings.work_dir.merged}/dev/shm`)) {
         await exec(`chmod 1777 ${this.settings.work_dir.merged}/dev/shm`, echo)
      }

      /**
       * Assegno 1777 a /tmp 
       * creava problemi con MXLINUX
       */
      if (!fs.existsSync(`${this.settings.work_dir.merged}/tmp`)) {
         await exec(`mkdir ${this.settings.work_dir.merged}/tmp`, echo)
      }
      await exec(`chmod 1777 ${this.settings.work_dir.merged}/tmp`, echo)
   }


   /**
   * syslinux
   */
   async syslinux(verbose = false) {
      const echo = Utils.setEcho(verbose)
      if (verbose) {
         console.log('ovary: syslinux')
         console.log('syslinux path: ' + this.settings.distro.syslinuxPath)
      }
      await exec(`cp ${this.settings.distro.syslinuxPath}/vesamenu.c32 ${this.settings.work_dir.pathIso}/isolinux/`, echo)
      await exec(`cp ${this.settings.distro.syslinuxPath}/chain.c32 ${this.settings.work_dir.pathIso}/isolinux/`, echo)
      if (Pacman.distro().familyId !== 'suse') {
         await exec(`cp ${this.settings.distro.syslinuxPath}/ldlinux.c32 ${this.settings.work_dir.pathIso}/isolinux/`, echo)
         await exec(`cp ${this.settings.distro.syslinuxPath}/libcom32.c32 ${this.settings.work_dir.pathIso}/isolinux/`, echo)
         await exec(`cp ${this.settings.distro.syslinuxPath}/libutil.c32 ${this.settings.work_dir.pathIso}/isolinux/`, echo)
      }
   }

   /**
    *  async isolinux
    */
   async isolinux(theme = 'eggs', verbose = false) {
      const echo = Utils.setEcho(verbose)
      if (verbose) {
         console.log('ovary: isolinux')
      }

      await exec(`cp ${this.settings.distro.isolinuxPath}/isolinux.bin ${this.settings.work_dir.pathIso}/isolinux/`, echo)
      await exec(`cp /etc/penguins-eggs.d/distros/${this.settings.distro.versionLike}/isolinux/isolinux.template.cfg ${this.settings.work_dir.pathIso}/isolinux/isolinux.cfg`, echo)
      await exec(`cp /etc/penguins-eggs.d/distros/${this.settings.distro.versionLike}/isolinux/stdmenu.template.cfg ${this.settings.work_dir.pathIso}/isolinux/stdmenu.cfg`, echo)
      const menuDest = this.settings.work_dir.pathIso + 'isolinux/menu.cfg'
      const splashDest = this.settings.work_dir.pathIso + 'isolinux/splash.png'

      /**
       * splashSrc e menuSrc possono essere riconfigurati dal tema
       */
      let splashSrc = path.resolve(__dirname, '../../assets/penguins-eggs-splash.png')
      const splashCandidate = path.resolve(__dirname, '../../addons/' + theme + '/theme/livecd/splash.png')
      if (fs.existsSync(splashCandidate)) {
         splashSrc = splashCandidate
      }

      let menuSrc = path.resolve(__dirname, '../../conf/distros/' + this.settings.distro.versionLike + '/isolinux/menu.template.cfg')
      const menuCandidate = path.resolve(__dirname, '../../addons/' + theme + '/theme/livecd/menu.template.cfg')
      if (fs.existsSync(menuCandidate)) {
         menuSrc = menuCandidate
      }

      fs.copyFileSync(splashSrc, splashDest)
      const template = fs.readFileSync(menuSrc, 'utf8')
      const view = {
         fullname: this.settings.remix.fullname.toUpperCase(),
         kernel: Utils.kernerlVersion(),
         vmlinuz: `/live${this.settings.vmlinuz}`,
         initrdImg: `/live${this.settings.initrdImg}`,
         cdlabel: `${Utils.getVolid(this.settings.remix.name)}`,
         usernameOpt: this.settings.config.user_opt,
         netconfigOpt: this.settings.config.netconfig_opt,
         timezoneOpt: this.settings.config.timezone,
         lang: process.env.LANG,
         locales: process.env.LANG,
      }
      fs.writeFileSync(menuDest, mustache.render(template, view))
   }

   /**
    * copy kernel
    */
   async copyKernel(verbose = false) {
      if (verbose) {
         console.log('ovary: liveKernel')
      }
      let failVmlinuz = false
      if (fs.existsSync(this.settings.kernel_image)) {
         shx.cp(this.settings.kernel_image, `${this.settings.work_dir.pathIso}/live/`)
      } else {
         failVmlinuz = true
      }

      let failInitrd = false
      if (fs.existsSync(this.settings.kernel_image)) {
         shx.cp(this.settings.initrd_image, `${this.settings.work_dir.pathIso}/live/`)
      } else {
         failInitrd = true
      }

      if (failVmlinuz || failInitrd) {
         Utils.error(`something went wrong! Cannot find ${this.settings.kernel_image} or ${this.settings.initrd_image}`)
         Utils.warning('Try to edit /etc/penguins-eggs.d/eggs.yaml and check for vmlinuz: /path/to/vmlinuz')
         Utils.warning('and initrd_img: vmlinuz: /path/to/initrd_img')
         process.exit(1)
      }
   }

   /**
    * squashFs: crea in live filesystem.squashfs
    */
   async makeSquashfs(scriptOnly = false, verbose = false) {
      let echo = { echo: false, ignore: false }
      if (verbose) {
         echo = { echo: true, ignore: false }
      }

      if (verbose) {
         console.log('ovary: makeSquashfs')
      }

      /**
       * exclude all the accurence of cryptdisks in rc0.d, etc
       */
      // let fexcludes = ["/boot/efi/EFI", "/etc/fstab", "/etc/mtab", "/etc/udev/rules.d/70-persistent-cd.rules", "/etc/udev/rules.d/70-persistent-net.rules"]
      //  for (let i in fexcludes) {
      //   this.addRemoveExclusion(true, fexcludes[i])
      // }


      /**
       * Non sò che fa, ma sicuro non serve per archlinux
       */
      if (Pacman.distro().familyId === 'debian') {
         const rcd = ['rc0.d', 'rc1.d', 'rc2.d', 'rc3.d', 'rc4.d', 'rc5.d', 'rc6.d', 'rcS.d']
         let files: string[]
         for (const i in rcd) {
            files = fs.readdirSync(`${this.settings.work_dir.merged}/etc/${rcd[i]}`)
            for (const n in files) {
               if (files[n].includes('cryptdisks')) {
                  this.addRemoveExclusion(true, `/etc/${rcd[i]}${files[n]}`)
               }
            }
         }
      }

      if (shx.exec('/usr/bin/test -L /etc/localtime', { silent: true }) && shx.exec('cat /etc/timezone', { silent: true }) !== 'Europe/Rome') {
         this.addRemoveExclusion(true, '/etc/localtime')
      }

      this.addRemoveExclusion(true, this.settings.config.snapshot_dir /* .absolutePath() */)

      const compression = `-comp ${this.settings.config.compression}`
      if (fs.existsSync(`${this.settings.work_dir.pathIso}/live/filesystem.squashfs`)) {
         fs.unlinkSync(`${this.settings.work_dir.pathIso}/live/filesystem.squashfs`)
      }

      // let cmd = `mksquashfs ${this.settings.work_dir.merged} ${this.settings.work_dir.pathIso}live/filesystem.squashfs ${compression} -wildcards -ef ${this.settings.config.snapshot_excludes} ${this.settings.session_excludes} `
      let cmd = `mksquashfs ${this.settings.work_dir.merged} ${this.settings.work_dir.pathIso}live/filesystem.squashfs ${compression} -wildcards -ef ${this.settings.config.snapshot_excludes} ${this.settings.session_excludes} `
      cmd = cmd.replace(/\s\s+/g, ' ')
      Utils.writeX(`${this.settings.work_dir.path}mksquashfs`, cmd)
      if (!scriptOnly) {
         Utils.warning('squashing filesystem: ' + compression)
         await exec(cmd, echo)
      }
   }

   /**
    * Restituisce true per le direcory da montare con overlay
    * 
    * Ci sono tre tipologie:
    * 
    * - normal solo la creazione della directory, nessun mount
    * - merged creazione della directory e mount ro
    * - mergedAndOverlay creazione directory, overlay e mount rw
    * 
    * @param dir
    */
   mergedAndOvelay(dir: string): boolean {
      const mountDirs = ['etc', 'boot', 'usr', 'var']
      let mountDir = ''
      let overlay = false
      for (mountDir of mountDirs) {
         if (mountDir === dir) {
            overlay = true
         }
      }
      return overlay
   }

   /**
    * Ritorna true se c'è bisogno del mount --bind
    * 
    * Ci sono tre tipologie:
    * 
    * - normal solo la creazione della directory, nessun mount
    * - merged creazione della directory e mount ro
    * - mergedAndOverlay creazione directory, overlay e mount rw
    * 
    * @param dir
    * 
    * @returns merged
    */
   merged(dir: string): boolean {
      const normalDirs = [
         'cdrom',
         'dev',
         'home',
         // 'live',
         'media',
         'mnt',
         'proc',
         'run',
         'sys',
         'swapfile',
         'tmp'
      ]
      // deepin ha due directory /data e recovery
      normalDirs.push('data')
      normalDirs.push('recovery')

      let merged = true
      for (const normalDir of normalDirs) {
         if (dir === normalDir) {
            merged = false
         }
      }
      return merged
   }

   /**
    * Esegue il bind del fs live e
    * crea lo script bind
    * 
    * @param verbose
    */
   async bindLiveFs(verbose = false) {
      const echo = Utils.setEcho(verbose)
      if (verbose) {
         console.log('ovary: bindLiveFs')
      }

      /**
       * Attenzione:
       * fs.readdirSync('/', { withFileTypes: true })
       * viene ignorato da Node8, ma da problemi da Node10 in poi
       */
      const dirs = fs.readdirSync('/')
      const startLine = `#############################################################`
      const titleLine = `# -----------------------------------------------------------`
      const endLine = `# ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n`

      let lnkDest = ''
      let cmd = ''
      const cmds: string[] = []
      cmds.push(`# NOTE: cdrom, dev, live, media, mnt, proc, run, sys and tmp`)
      cmds.push(`#       need just a mkdir in ${this.settings.work_dir.merged}`)
      cmds.push(`# host: ${os.hostname()} user: ${Utils.getPrimaryUser()}\n`)

      for (const dir of dirs) {
         cmds.push(startLine)
         if (N8.isDirectory(dir)) {
            if (dir !== 'lost+found') {
               cmd = `# /${dir} is a directory`
               if (this.mergedAndOvelay(dir)) {
                  /**
                   * mergedAndOverlay creazione directory, overlay e mount rw
                   */
                  cmds.push(`${cmd} need to be presente, and rw`)
                  cmds.push(titleLine)
                  cmds.push(`# create mountpoint lower`)
                  cmds.push(await makeIfNotExist(`${this.settings.work_dir.lowerdir}/${dir}`))
                  cmds.push(`# first: mount /${dir} rw in ${this.settings.work_dir.lowerdir}/${dir}`)
                  cmds.push(await rexec(`mount --bind --make-slave /${dir} ${this.settings.work_dir.lowerdir}/${dir}`, verbose))
                  cmds.push(`# now remount it ro`)
                  cmds.push(await rexec(`mount -o remount,bind,ro ${this.settings.work_dir.lowerdir}/${dir}`, verbose))
                  cmds.push(`\n# second: create mountpoint upper, work and ${this.settings.work_dir.merged} and mount ${dir}`)
                  cmds.push(await makeIfNotExist(`${this.settings.work_dir.upperdir}/${dir}`, verbose))
                  cmds.push(await makeIfNotExist(`${this.settings.work_dir.workdir}/${dir}`, verbose))
                  cmds.push(await makeIfNotExist(`${this.settings.work_dir.merged}/${dir}`, verbose))
                  cmds.push(`\n# thirth: mount /${dir} rw in ${this.settings.work_dir.merged}`)
                  cmds.push(await rexec(`mount -t overlay overlay -o lowerdir=${this.settings.work_dir.lowerdir}/${dir},upperdir=${this.settings.work_dir.upperdir}/${dir},workdir=${this.settings.work_dir.workdir}/${dir} ${this.settings.work_dir.merged}/${dir}`, verbose))
               } else if (this.merged(dir)) {
                  /*
                  * merged creazione della directory e mount ro
                  */
                  cmds.push(`${cmd} need to be present, mount ro`)
                  cmds.push(titleLine)
                  cmds.push(await makeIfNotExist(`${this.settings.work_dir.merged}/${dir}`, verbose))
                  cmds.push(await rexec(`mount --bind --make-slave /${dir} ${this.settings.work_dir.merged}/${dir}`, verbose))
                  cmds.push(await rexec(`mount -o remount,bind,ro ${this.settings.work_dir.merged}/${dir}`, verbose))
               } else {
                  /**
                   * normal solo la creazione della directory, nessun mount
                   */
                  cmds.push(`${cmd} need to be present, no mount`)
                  cmds.push(titleLine)
                  cmds.push(await makeIfNotExist(`${this.settings.work_dir.merged}/${dir}`, verbose))
                  cmds.push(`# mount -o bind /${dir} ${this.settings.work_dir.merged}/${dir}`)
               }
            }
         } else if (N8.isFile(dir)) {
            cmds.push(`# /${dir} is just a file`)
            cmds.push(titleLine)
            if (!fs.existsSync(`${this.settings.work_dir.merged}/${dir}`)) {
               cmds.push(await rexec(`cp /${dir} ${this.settings.work_dir.merged}`, verbose))
            } else {
               cmds.push('# file exist... skip')
            }
         } else if (N8.isSymbolicLink(dir)) {
            lnkDest = fs.readlinkSync(`/${dir}`)
            cmds.push(`# /${dir} is a symbolic link to /${lnkDest} in the system`)
            cmds.push(`# we need just to recreate it`)
            cmds.push(`# ln -s ${this.settings.work_dir.merged}/${lnkDest} ${this.settings.work_dir.merged}/${lnkDest}`)
            cmds.push(`# but we don't know if the destination exist, and I'm too lazy today. So, for now: `)
            cmds.push(titleLine)
            if (!fs.existsSync(`${this.settings.work_dir.merged}/${dir}`)) {
               if (fs.existsSync(lnkDest)) {
                  cmds.push(`ln -s ${this.settings.work_dir.merged}/${lnkDest} ${this.settings.work_dir.merged}/${lnkDest}`)
               } else {
                  cmds.push(await rexec(`cp -r /${dir} ${this.settings.work_dir.merged}`, verbose))
               }
            } else {
               cmds.push('# SymbolicLink exist... skip')
            }
         }
         cmds.push(endLine)
      }
      Utils.writeXs(`${this.settings.work_dir.path}bind`, cmds)
   }

   /**
    * ubind del fs live
    * @param verbose
    */
   async uBindLiveFs(verbose = false) {
      const echo = Utils.setEcho(verbose)
      if (verbose) {
         console.log('ovary: uBindLiveFs')
      }

      const cmds: string[] = []
      cmds.push(`# NOTE: home, cdrom, dev, live, media, mnt, proc, run, sys and tmp`)
      cmds.push(`#       need just to be removed in ${this.settings.work_dir.merged}`)
      cmds.push(`# host: ${os.hostname()} user: ${Utils.getPrimaryUser()}\n`)

      // await exec(`/usr/bin/pkill mksquashfs; /usr/bin/pkill md5sum`, {echo: true})
      if (fs.existsSync(this.settings.work_dir.merged)) {
         const bindDirs = fs.readdirSync(this.settings.work_dir.merged, {
            withFileTypes: true
         })

         for (const dir of bindDirs) {
            const dirname = N8.dirent2string(dir)

            cmds.push(`#############################################################`)
            if (N8.isDirectory(dirname)) {
               cmds.push(`\n# directory: ${dirname}`)
               if (this.mergedAndOvelay(dirname)) {
                  cmds.push(`\n# ${dirname} has overlay`)
                  cmds.push(`\n# First, umount it from ${this.settings.work_dir.path}`)
                  cmds.push(await rexec(`umount ${this.settings.work_dir.merged}/${dirname}`, verbose))

                  cmds.push(`\n# Second, umount it from ${this.settings.work_dir.lowerdir}`)
                  cmds.push(await rexec(`umount ${this.settings.work_dir.lowerdir}/${dirname}`, verbose))
               } else if (this.merged(dirname)) {
                  cmds.push(await rexec(`umount ${this.settings.work_dir.merged}/${dirname}`, verbose))
               }
               cmds.push(`\n# remove in ${this.settings.work_dir.merged} and ${this.settings.work_dir.lowerdir}`)
               if (dirname !== 'home') {
                  cmds.push(await rexec(`rm ${this.settings.work_dir.merged}/${dirname} -rf`, verbose))
               }
               cmds.push(await rexec(`rm ${this.settings.work_dir.lowerdir}/${dirname} -rf`, verbose))
            } else if (N8.isFile(dirname)) {
               cmds.push(`\n# ${dirname} = file`)
               cmds.push(await rexec(`rm ${this.settings.work_dir.merged}/${dirname}`, verbose))
            } else if (N8.isSymbolicLink(dirname)) {
               cmds.push(`\n# ${dirname} = symbolicLink`)
               cmds.push(await rexec(`rm ${this.settings.work_dir.merged}/${dirname}`, verbose))
            }
         }
      }
      Utils.writeXs(`${this.settings.work_dir.path}ubind`, cmds)
   }

   /**
    * bind dei virtual file system
    */
   async bindVfs(verbose = false) {
      const cmds: string[] = []
      cmds.push(`mount -o bind /dev ${this.settings.work_dir.merged}/dev`)
      cmds.push(`mount -o bind /dev/pts ${this.settings.work_dir.merged}/dev/pts`)
      cmds.push(`mount -o bind /proc ${this.settings.work_dir.merged}/proc`)
      cmds.push(`mount -o bind /sys ${this.settings.work_dir.merged}/sys`)
      cmds.push(`mount -o bind /run ${this.settings.work_dir.merged}/run`)
      Utils.writeXs(`${this.settings.work_dir.path}bindvfs`, cmds)
   }

   /**
    * 
    * @param verbose 
    */
   async ubindVfs(verbose = false) {
      const cmds: string[] = []
      cmds.push(`umount ${this.settings.work_dir.merged}/dev/pts`)
      cmds.push(`umount ${this.settings.work_dir.merged}/dev`)
      cmds.push(`umount ${this.settings.work_dir.merged}/proc`)
      cmds.push(`umount ${this.settings.work_dir.merged}/run`)
      // cmds.push(`umount ${this.settings.work_dir.merged}/sys/fs/fuse/connections`)
      cmds.push(`umount ${this.settings.work_dir.merged}/sys`)
      Utils.writeXs(`${this.settings.work_dir.path}ubindvfs`, cmds)
   }


   /**
    * 
    * @param verbose 
    */
   async getUsersDatasSize(verbose = false): Promise<number> {
      const echo = Utils.setEcho(verbose)
      if (verbose) {
         Utils.warning('copyUsersDatas')
      }

      const cmds: string[] = []
      const cmd = `chroot / getent passwd {1000..60000} |awk -F: '{print $1}'`
      const result = await exec(cmd, {
         echo: verbose,
         ignore: false,
         capture: true
      })
      // Filter serve a rimuovere gli elementi vuoti
      const users: string[] = result.data.split('\n').filter(Boolean)
      let size = 0
      let blocksNeed = 0
      Utils.warning('We found ' + users.length + ' users')
      for (let i = 0; i < users.length; i++) {
         // esclude tutte le cartelle che NON sono users
         if (users[i] !== this.settings.config.user_opt) {
            // du restituisce size in Kbytes senza -b
            // const bytes = parseInt(shx.exec(`du -b --summarize /home/${users[i]} |awk '{ print $1 }'`, { silent: true }).stdout.trim())
            // size += bytes
            const blocks = parseInt(shx.exec(`du --summarize /home/${users[i]} |awk '{ print $1 }'`, { silent: true }).stdout.trim())
            blocksNeed += blocks
         }
      }
      size = blocksNeed * 4096
      return size
   }

   /**
    * 
    * @param verbose 
    */
   async copyUsersDatas(verbose = false) {
      const echo = Utils.setEcho(verbose)
      if (verbose) {
         Utils.warning('copyUsersDatas')
      }

      const cmds: string[] = []
      // take original users in croot there is just live now
      const cmd = `getent passwd {1000..60000} |awk -F: '{print $1}'`
      const result = await exec(cmd, {
         echo: verbose,
         ignore: false,
         capture: true
      })
      const users: string[] = result.data.split('\n')
      execSync('mkdir -p /mnt/home', { stdio: 'inherit' })
      for (let i = 0; i < users.length - 1; i++) {
         // ad esclusione dell'utente live...
         if (users[i] !== this.settings.config.user_opt) {
            execSync('mkdir -p /mnt/home/' + users[i], { stdio: 'inherit' })
            execSync('rsync -a /home/' + users[i] + '/ ' + '/mnt/home/' + users[i] + '/', { stdio: 'inherit' })
         }
      }
      execSync('mkdir -p /mnt/etc', { stdio: 'inherit' })
      execSync('cp /etc/passwd /mnt/etc', { stdio: 'inherit' })
      execSync('cp /etc/shadow /mnt/etc', { stdio: 'inherit' })
      execSync('cp /etc/group /mnt/etc', { stdio: 'inherit' })
   }

   /**
    * 
    * @param verbose 
    */
   async cleanUsersAccounts(verbose = false) {
      const echo = Utils.setEcho(verbose)
      /**
       * delete all user in chroot
       */
      const cmds: string[] = []
      const cmd = `chroot ${this.settings.work_dir.merged} getent passwd {1000..60000} |awk -F: '{print $1}'`
      const result = await exec(cmd, {
         echo: verbose,
         ignore: false,
         capture: true
      })
      const users: string[] = result.data.split('\n')
      for (let i = 0; i < users.length - 1; i++) {
         // cmds.push(await rexec(`chroot ${this.settings.work_dir.merged} deluser ${users[i]}`, verbose))
         cmds.push(await rexec(`chroot ${this.settings.work_dir.merged} userdel ${users[i]}`, verbose))
      }

   }

   /**
    * list degli utenti: grep -E 1[0-9]{3}  /etc/passwd | sed s/:/\ / | awk '{print $1}'
    * create la home per user_opt
    * @param verbose
    */
   async createUserLive(verbose = false) {
      const echo = Utils.setEcho(verbose)
      if (verbose) {
         console.log('ovary: createUserLive')
      }
      const cmds: string[] = []
      cmds.push(await rexec('chroot ' + this.settings.work_dir.merged + ' rm /home/' + this.settings.config.user_opt + ' -rf', verbose))
      cmds.push(await rexec('chroot ' + this.settings.work_dir.merged + ' mkdir /home/' + this.settings.config.user_opt, verbose))
      if (Pacman.distro().familyId === 'fedora') {
         cmds.push(await rexec('chroot ' + this.settings.work_dir.merged + ' useradd ' + this.settings.config.user_opt + ' --home-dir /home/' + this.settings.config.user_opt + ' --shell /bin/bash --password ' + this.settings.config.user_opt_passwd, verbose))
      } else {
         cmds.push(await rexec('chroot ' + this.settings.work_dir.merged + ' useradd ' + this.settings.config.user_opt + ' --home-dir /home/' + this.settings.config.user_opt + ' --shell /bin/bash ', verbose))
         cmds.push(await rexec('chroot ' + this.settings.work_dir.merged + ' echo ' + this.settings.config.user_opt + ':' + this.settings.config.user_opt_passwd + '| chroot ' + this.settings.work_dir.merged + ' chpasswd', verbose))
      }
      cmds.push(await rexec('chroot  ' + this.settings.work_dir.merged + ' cp /etc/skel/. /home/' + this.settings.config.user_opt + ' -R', verbose))

      if (Pacman.distro().familyId !== 'suse') {
         cmds.push(await rexec('chroot  ' + this.settings.work_dir.merged + ' chown ' + this.settings.config.user_opt + ':' + this.settings.config.user_opt + ' /home/' + this.settings.config.user_opt + ' -R', verbose))
      } else {
         cmds.push(await rexec('chroot  ' + this.settings.work_dir.merged + ' chown ' + this.settings.config.user_opt + ':users' + ' /home/' + this.settings.config.user_opt + ' -R', verbose))
      }

      // Aggiungo utente a sudo o wheel
      if (Pacman.distro().familyId !== 'debian') {
         cmds.push(await rexec(`chroot ${this.settings.work_dir.merged} usermod -aG wheel ${this.settings.config.user_opt}`, verbose))
      } else {
         cmds.push(await rexec(`chroot ${this.settings.work_dir.merged} usermod -aG sudo ${this.settings.config.user_opt}`, verbose))
      }

      /**
       * Cambio passwd root
       */
      if (Pacman.distro().familyId !== 'fedora') {
         cmds.push(await rexec(`chroot ${this.settings.work_dir.merged} echo root:${this.settings.config.root_passwd} | chroot ${this.settings.work_dir.merged} chpasswd `, verbose))
      }
   }

   /**
    * 
    */
   async createXdgAutostart(theme = 'eggs', myAddons: IMyAddons, verbose = false) {
      const echo = Utils.setEcho(verbose)
      if (verbose) {
         console.log('ovary: createXdgAutostart()')
      }


      const pathHomeLive = `/home/${this.settings.config.user_opt}`

      // Copia icona penguins-eggs
      shx.cp(path.resolve(__dirname, '../../assets/eggs.png'), '/usr/share/icons/')
      shx.cp(path.resolve(__dirname, '../../assets/krill.svg'), '/usr/share/icons/')

      /**
       * creazione dei link in /usr/share/applications
       * 
       */
      shx.cp(path.resolve(__dirname, '../../assets/penguins-eggs.desktop'), '/usr/share/applications/')

      let installerUrl = 'install-debian.desktop'
      let installerIcon = `install-debian`
      if (Pacman.packageIsInstalled('calamares')) {
         shx.cp(path.resolve(__dirname, `../../addons/${theme}/theme/applications/install-debian.desktop`), `${this.settings.work_dir.merged}/usr/share/applications/`)
      } else {
         installerUrl = 'penguins-krill.desktop'
         installerIcon = 'utilities-terminal'
         shx.cp(path.resolve(__dirname, '../../assets/penguins-krill.desktop'), `${this.settings.work_dir.merged}/usr/share/applications/`)
      }

      // flags
      if (myAddons.adapt) {
         // Per lxde, lxqt, deepin, mate, xfce4
         if (Pacman.packageIsInstalled('lxde-core') || Pacman.packageIsInstalled('deepin-desktop-base') || Pacman.packageIsInstalled('mate-desktop') || Pacman.packageIsInstalled('ubuntu-mate-core') || Pacman.packageIsInstalled('xfce4')) {
            const dirAddon = path.resolve(__dirname, `../../addons/eggs/adapt/`)
            shx.cp(`${dirAddon}/applications/eggs-adapt.desktop`, `${this.settings.work_dir.merged}/usr/share/applications/`)
            shx.cp(`${dirAddon}/bin/penguins-adapt.sh`, `${this.settings.work_dir.merged}/usr/local/bin/`)
         }
      }

      if (myAddons.ichoice) {
         installerUrl = 'eggs-ichoice.desktop'
         installerIcon = 'system-software-install'
         const dirAddon = path.resolve(__dirname, `../../addons/eggs/ichoice/`)
         shx.cp(`${dirAddon}/applications/eggs-ichoice.desktop`, `${this.settings.work_dir.merged}/usr/share/applications/`)
         shx.cp(`${dirAddon}/bin/eggs-ichoice.sh`, `${this.settings.work_dir.merged}/usr/local/bin/`)
      }

      if (myAddons.pve) {
         // Imposto service pve-lite
         const pve = new PveLive()
         pve.create(this.settings.work_dir.merged)

         const dirAddon = path.resolve(__dirname, `../../addons/eggs/pve`)
         shx.cp(`${dirAddon}/artwork/eggs-pve.png`, `${this.settings.work_dir.merged}/usr/share/icons/`)
         shx.cp(`${dirAddon}/applications/eggs-pve.desktop`, `${this.settings.work_dir.merged}/usr/share/applications/`)
      }

      if (myAddons.rsupport) {
         const dirAddon = path.resolve(__dirname, `../../addons/eggs/rsupport`)
         shx.cp(`${dirAddon}/applications/eggs-rsupport.desktop`, `${this.settings.work_dir.merged}/usr/share/applications/`)
         shx.cp(`${dirAddon}/artwork/eggs-rsupport.png`, `${this.settings.work_dir.merged}/usr/share/icons/`)
      }

      /**
       * configuro add-penguins-desktop-icons in /etc/xdg/autostart
       */
      const dirAutostart = `${this.settings.work_dir.merged}/etc/xdg/autostart`
      const dirRun = '/usr/bin'
      if (fs.existsSync(dirAutostart)) {
         // Creo l'avviatore xdg DEVE essere add-penguins-links.desktop
         shx.cp(path.resolve(__dirname, `../../assets/penguins-links-add.desktop`), dirAutostart)

         // Creo lo script add-penguins-links.sh
         const script = `${dirRun}/penguins-links-add.sh`
         let text = ''
         text += '#!/bin/sh\n'
         text += 'DESKTOP=$(xdg-user-dir DESKTOP)\n'
         text += '# Create ~/Desktop just in case this runs before the xdg folder creation script\n'
         text += 'mkdir -p $DESKTOP\n'
         // Anche se in lxde rimane il problema della conferma dell'avvio
         // per l'installer, lo tolgo altrimenti su LXDE riappare comunque
         text += `cp /usr/share/applications/${installerUrl} $DESKTOP\n`
         if (Pacman.packageIsInstalled('lxde-core')) {
            text += this.lxdeLink('penguins-eggs.desktop', 'penguin\'s eggs', 'eggs')
            if (myAddons.adapt) text += this.lxdeLink('eggs-adapt.desktop', 'Adapt', 'video-display')
            if (myAddons.pve) text += this.lxdeLink('eggs-pve.desktop', 'Proxmox VE', 'proxmox-ve')
            if (myAddons.rsupport) text += this.lxdeLink('eggs-rsupport.desktop', 'Remote assistance', 'remote-assistance')
         } else {
            text += 'cp /usr/share/applications/penguins-eggs.desktop $DESKTOP\n'
            if (myAddons.adapt) text += 'cp /usr/share/applications/eggs-adapt.desktop $DESKTOP\n'
            if (myAddons.pve) text += 'cp /usr/share/applications/eggs-pve.desktop $DESKTOP\n'
            if (myAddons.rsupport) text += 'cp /usr/share/applications/eggs-rsupport.desktop $DESKTOP\n'
         }
         fs.writeFileSync(script, text, 'utf8')
         await exec(`chmod a+x ${script}`, echo)
      }

      await Xdg.autologin(Utils.getPrimaryUser(), this.settings.config.user_opt, this.settings.work_dir.merged)
   }

   /**
    * Creazione link desktop per lxde
    * @param name 
    * @param icon 
    */
   private lxdeLink(file: string, name: string, icon: string): string {
      const lnk = `lnk-${file}`

      let text = ''
      text += `echo "[Desktop Entry]" >$DESKTOP/${lnk}\n`
      text += `echo "Type=Link" >> $DESKTOP/${lnk}\n`
      text += `echo "Name=${name}" >> $DESKTOP/${lnk}\n`
      text += `echo "Icon=${icon}" >> $DESKTOP/${lnk}\n`
      text += `echo "URL=/usr/share/applications/${file}" >> $DESKTOP/${lnk}\n\n`

      return text
   }


   /**
    * Add or remove exclusion
    * @param add {boolean} true = add, false remove
    * @param exclusion {atring} path to add/remove
    */
   addRemoveExclusion(add: boolean, exclusion: string): void {
      if (exclusion.startsWith('/')) {
         exclusion = exclusion.substring(1) // remove / initial Non compatible with
      }

      if (add) {
         if (this.settings.session_excludes === '') {
            this.settings.session_excludes += `-e '${exclusion}' `
         } else {
            this.settings.session_excludes += ` '${exclusion}' `
         }
      } else {
         this.settings.session_excludes.replace(` '${exclusion}'`, '')
         if (this.settings.session_excludes === '-e') {
            this.settings.session_excludes = ''
         }
      }
   }

   /**
    * makeEfi
    * Create /boot and /efi for UEFI
    */
   async makeEfi(theme = 'eggs', verbose = false) {
      const echo = Utils.setEcho(verbose)
      if (verbose) {
         console.log('ovary: makeEfi')
      }

      // Controlla la presenza di grub
      let grubInstalled = false
      if (Pacman.distro().familyId === 'debian') {
         if (Pacman.packageIsInstalled('grub-common')) {
            grubInstalled = true
         }
      } else if (Pacman.distro().familyId === 'fedora') {
         if (Pacman.packageIsInstalled('grub2-common.noarch')) {
            grubInstalled = true
         }
      } else if (Pacman.distro().familyId === 'archlinux') {
         if (Pacman.packageIsInstalled('grub')) {
            grubInstalled = true
         }
      } else if (Pacman.distro().familyId === 'suse') {
         if (Pacman.packageIsInstalled('grub2')) {
            grubInstalled = true
         }
      }

      if (!grubInstalled) {
         Utils.error(`something went wrong! Cannot find package grub-common.`)
         Utils.warning('Problably your system boot with rEFInd or others, to generate a UEFI image we need grub too')
         process.exit(1)
      }


      /**
       * Carica il primo grub.cfg dal memdisk, quindi in sequenza
       * grub.cfg1 -> memdisk
       * grub.cfg2 -> /boot/grub/x86_64-efi
       * grub.cfg3 -> /boot/grub
       */
      const tempDir = shx.exec('mktemp -d /tmp/work_temp.XXXX', { silent: true }).stdout.trim()

      // for initial grub.cfg
      shx.mkdir('-p', `${tempDir}/boot/grub`)
      const grubCfg = `${tempDir}/boot/grub/grub.cfg`
      shx.touch(grubCfg)
      let text = ''
      text += 'search --file --set=root /isolinux/isolinux.cfg\n'
      text += 'set prefix=($root)/boot/grub\n'
      text += `source $prefix/${Utils.machineUEFI()}/grub.cfg\n`
      Utils.write(grubCfg, text)

      /**
       * Andiamo a costruire efi_work
       */
      if (!fs.existsSync(this.settings.efi_work)) {
         shx.mkdir('-p', this.settings.efi_work)
      }

      // salviamo currentDir
      const currentDir = process.cwd()

      /**
       * efi_work
       */
      process.chdir(this.settings.efi_work)

      /**
       * start with empty directories: clear dir boot and efi
       */
      const files = fs.readdirSync('.');
      for (var i in files) {
         if (files[i] === './boot') {
            await exec(`rm ./boot -rf`, echo)
         }
         if (files[i] === './efi') {
            await exec(`rm ./efi -rf`, echo)
         }
      }
      shx.mkdir('-p', `./boot/grub/${Utils.machineUEFI()}`)
      shx.mkdir('-p', './efi/boot')

      // second grub.cfg file
      let cmd = `for i in $(ls /usr/lib/grub/${Utils.machineUEFI()}|grep part_|grep .mod|sed \'s/.mod//\'); do echo "insmod $i" >> boot/grub/${Utils.machineUEFI()}/grub.cfg; done`
      await exec(cmd, echo)

      // Additional modules so we don't boot in blind mode. I don't know which ones are really needed.
      // cmd = `for i in efi_gop efi_uga ieee1275_fb vbe vga video_bochs video_cirrus jpeg png gfxterm ; do echo "insmod $i" >> boot/grub/x86_64-efi/grub.cfg ; done`
      cmd = `for i in efi_gop efi_gop efi_uga gfxterm video_bochs video_cirrus jpeg png ; do echo "insmod $i" >> boot/grub/${Utils.machineUEFI()}/grub.cfg ; done`
      await exec(cmd, echo)

      await exec(`echo source /boot/grub/grub.cfg >> boot/grub/${Utils.machineUEFI()}/grub.cfg`, echo)
      /**
       * fine lavoro in efi_work
       */

      // Torniamo alla directory precedente
      process.chdir(tempDir)

      // make a tarred "memdisk" to embed in the grub image
      await exec('tar -cvf memdisk boot', echo)

      // make the grub image
      let grubMkImage = 'grub-mkimage '
      let destArch = Utils.machineUEFI()

      await exec(`${grubMkImage} -O ${destArch} -m memdisk -o bootx64.efi -p '(memdisk)/boot/grub' search iso9660 configfile normal memdisk tar cat part_msdos part_gpt fat ext2 ntfs ntfscomp hfsplus chain boot linux`, echo)
      // pospd (torna a efi_work)
      process.chdir(this.settings.efi_work)

      // copy the grub image to efi/boot (to go later in the device's root)
      shx.cp(`${tempDir}/bootx64.efi`, `./efi/boot`)

      // Do the boot image "boot/grub/efiboot.img"
      await exec('dd if=/dev/zero of=boot/grub/efiboot.img bs=1K count=1440', echo)
      await exec('/sbin/mkdosfs -F 12 boot/grub/efiboot.img', echo)
      shx.mkdir('-p', 'img-mnt')
      await exec('mount -o loop boot/grub/efiboot.img img-mnt', echo)
      shx.mkdir('-p', 'img-mnt/efi/boot')
      shx.cp('-r', `${tempDir}/bootx64.efi`, 'img-mnt/efi/boot/')

      // ###############################

      // copy modules and font
      shx.cp('-r', `/usr/lib/grub/${destArch}/*`, `boot/grub/${Utils.machineUEFI()}/`)

      // if this doesn't work try another font from the same place (grub's default, unicode.pf2, is much larger)
      // Either of these will work, and they look the same to me. Unicode seems to work with qemu. -fsr
      if (fs.existsSync('/usr/share/grub/unicode.pf2')){
         fs.copyFileSync('/usr/share/grub/unicode.pf2', 'boot/grub/font.pf2')
      } else if (fs.existsSync('/usr/share/grub2/unicode.pf2')){
         fs.copyFileSync('/usr/share/grub2/unicode.pf2', 'boot/grub/font.pf2')
      }


      // doesn't need to be root-owned ${pwd} = current Directory
      // const user = Utils.getPrimaryUser()
      // await exec(`chown -R ${user}:${user} $(pwd) 2>/dev/null`, echo)
      // console.log(`pwd: ${pwd}`)
      // await exec(`chown -R ${user}:${user} $(pwd)`, echo)

      // Cleanup efi temps
      await exec('umount img-mnt', echo)
      await exec('rmdir img-mnt', echo)

      // popD Torna alla directory corrente
      process.chdir(currentDir)

      // Copy efi files to iso
      await exec(`rsync -ax  ${this.settings.efi_work}/boot ${this.settings.work_dir.pathIso}/`, echo)
      await exec(`rsync -ax ${this.settings.efi_work}/efi  ${this.settings.work_dir.pathIso}/`, echo)

      /**
       * Do the main grub.cfg (which gets loaded last):
       */
      // fs.copyFileSync(path.resolve(__dirname, `../../conf/distros/${this.settings.distro.versionLike}/grub/loopback.cfg`), `${this.settings.work_dir.pathIso}/boot/grub/loopback.cfg`)
      fs.copyFileSync(`/etc/penguins-eggs.d/distros/${this.settings.distro.versionLike}/grub/loopback.cfg`, `${this.settings.work_dir.pathIso}/boot/grub/loopback.cfg`)

      /**
       * in theme va al momento theme.cfg e splash.png
       */
      // const grubSrc = path.resolve(__dirname, `../../conf/distros/${this.settings.distro.versionLike}/grub/grub.template.cfg`)
      const grubSrc = `/etc/penguins-eggs.d/distros/${this.settings.distro.versionLike}/grub/grub.template.cfg`
      // let themeSrc = path.resolve(__dirname, `../../conf/distros/${this.settings.distro.versionLike}/grub/theme.cfg`)
      let themeSrc = `/etc/penguins-eggs.d/distros/${this.settings.distro.versionLike}/grub/theme.cfg`
      let splashSrc = path.resolve(__dirname, '../../assets/penguins-eggs-splash.png')

      const grubDest = `${this.settings.work_dir.pathIso}/boot/grub/grub.cfg`
      const themeDest = `${this.settings.work_dir.pathIso}/boot/grub/theme.cfg`
      const splashDest = `${this.settings.work_dir.pathIso}/isolinux/splash.png`

      // if a theme exist, change splash with theme splash of the theme
      const splashCandidate = path.resolve(__dirname, `../../addons/${theme}/theme/livecd/splash.png`)
      if (fs.existsSync(splashCandidate)) {
         splashSrc = splashCandidate
      }

      // if a theme exist, change theme.cfg with theme.cfg of the theme
      const themeCandidate = path.resolve(__dirname, `../../addons/${theme}/theme/livecd/theme.cfg`)
      if (fs.existsSync(themeCandidate)) {
         themeSrc = themeCandidate
      }
      fs.copyFileSync(themeSrc, themeDest)
      fs.copyFileSync(splashSrc, splashDest)


      // Utilizzo mustache
      const template = fs.readFileSync(grubSrc, 'utf8')
      const view = {
         fullname: this.settings.remix.fullname.toUpperCase(),
         kernel: Utils.kernerlVersion(),
         vmlinuz: `/live${this.settings.vmlinuz}`,
         initrdImg: `/live${this.settings.initrdImg}`,
         usernameOpt: this.settings.config.user_opt,
         netconfigOpt: this.settings.config.netconfig_opt,
         timezoneOpt: this.settings.config.timezone,
         lang: process.env.LANG,
         locales: process.env.LANG,
      }
      fs.writeFileSync(grubDest, mustache.render(template, view))
   }

   /**
    * makeDotDisk
    * create .disk/info, .disk/mksquashfs, .disk/mkiso
    * return mkiso
    */
   makeDotDisk(backup = false, verbose = false): string {
      const dotDisk = this.settings.work_dir.pathIso + '/.disk'
      if (fs.existsSync(dotDisk)) {
         shx.rm('-rf', dotDisk)
      }
      shx.mkdir('-p', dotDisk)


      // .disk/info
      let file = dotDisk + '/info'
      let content = this.settings.config.snapshot_prefix + this.settings.config.snapshot_basename
      fs.writeFileSync(file, content, 'utf-8')

      // .disk/mksquashfs
      const scripts = this.settings.work_dir.path
      shx.cp(scripts + '/mksquashfs', dotDisk + '/mksquashfs')

      // .disk/mkisofs
      file = dotDisk + '/mkisofs'
      let volid = Utils.getVolid(this.settings.remix.name)
      let prefix = this.settings.config.snapshot_prefix
      if (backup) {
         if (prefix.substring(0, 7) === 'egg-of-') {
            prefix = 'egg-EB-' + prefix.substring(7)
         } else {
            prefix = 'egg-EB-' + prefix
         }
      }
      let output = this.settings.config.snapshot_dir + prefix + volid
      content = this.xorrisoCommand()

      /**
       * rimuovo gli spazi
       */
      content = content.replace(/\s\s+/g, ' ')
      fs.writeFileSync(file, content, 'utf-8')
      return content
   }

   /**
    * 
    * @param backup 
    * @returns cmd 4 mkiso
    */
   xorrisoCommand(backup = false): string {
      let command = ''
      const prefix = Utils.getPrefix(this.settings.config.snapshot_prefix, backup)
      const volid = Utils.getVolid(this.settings.remix.name)
      const postfix = Utils.getPostfix()
      this.settings.isoFilename = prefix + volid + postfix
      const output = this.settings.config.snapshot_dir + this.settings.isoFilename
      const distro = Pacman.distro()
      const appid = `-appid "${distro.distroId}" `
      const publisher = `-publisher "${distro.distroId}/${distro.versionId}" `
      const preparer = `-preparer "prepared by eggs <https://penguins-eggs.net>" `

      if (distro.familyId === 'debian') {
         let isoHybridMbr = `-isohybrid-mbr ${this.settings.distro.isolinuxPath}isohdpfx.bin `
         if (this.settings.config.make_isohybrid) {
            if (fs.existsSync('/usr/lib/syslinux/mbr/isohdpfx.bin')) {
               isoHybridMbr = '-isohybrid-mbr /usr/lib/syslinux/mbr/isohdpfx.bin'
            } else if (fs.existsSync('/usr/lib/syslinux/isohdpfx.bin')) {
               isoHybridMbr = '-isohybrid-mbr /usr/lib/syslinux/isohdpfx.bin'
            } else if (fs.existsSync('/usr/lib/ISOLINUX/isohdpfx.bin')) {
               isoHybridMbr = '-isohybrid-mbr /usr/lib/ISOLINUX/isohdpfx.bin'
            } else {
               Utils.warning("Can't create isohybrid. File: isohdpfx.bin not found. The resulting image will be a standard iso file")
            }
         }

         let uefi_opt = ''
         if (this.settings.config.make_efi) {
            uefi_opt = '-eltorito-alt-boot -e boot/grub/efiboot.img \
                        -isohybrid-gpt-basdat \
                        -no-emul-boot'
         }

         command = `xorriso -as mkisofs \
         -volid ${volid} \
         -full-iso9660-filenames \
         -joliet \
         -joliet-long \
         -iso-level 3 \
         -rational-rock \
         ${appid} \
         ${publisher} \
         ${preparer} \
         ${isoHybridMbr} \
         -eltorito-boot isolinux/isolinux.bin \
         -no-emul-boot \
         -boot-load-size 4 \
         -boot-info-table \
         ${uefi_opt} \
         -isohybrid-gpt-basdat
         -no-emul-boot \
         -output ${output} \
         ${this.settings.work_dir.pathIso}`

      } else if (distro.familyId === 'fedora') {
         command = `xorriso -as mkisofs \
         -volid ${volid} \
         -full-iso9660-filenames \
         -joliet \
         -joliet-long \
         -iso-level 3 \
         -rational-rock \
         ${appid} \
         ${publisher} \
         ${preparer} \
         -isohybrid-mbr /usr/share/syslinux/isohdpfx.bin
         -eltorito-boot isolinux/isolinux.bin \
         -no-emul-boot \
         -boot-load-size 4 \
         -boot-info-table \
         -eltorito-alt-boot -e boot/grub/efiboot.img \
         -isohybrid-gpt-basdat
         -no-emul-boot \
         -output ${output} \
         ${this.settings.work_dir.pathIso}`
      } else if (distro.familyId === 'archlinux') {
         command = `xorriso -as mkisofs \
         -volid ${volid} \
         -full-iso9660-filenames \
         -joliet \
         -joliet-long \
         -iso-level 3 \
         -rational-rock \
         ${appid} \
         ${publisher} \
         ${preparer} \
         -isohybrid-mbr /usr/lib/syslinux/bios/isohdpfx.bin
         -eltorito-boot isolinux/isolinux.bin \
         -no-emul-boot \
         -boot-load-size 4 \
         -boot-info-table \
         -eltorito-alt-boot -e boot/grub/efiboot.img \
         -isohybrid-gpt-basdat
         -no-emul-boot \
         -output ${output} \
         ${this.settings.work_dir.pathIso}`
      }
      return command
   }

   /**
    * makeIso
    * cmd: cmd 4 xorirriso
    */
   async makeIso(cmd: string, backup = false, scriptOnly = false, verbose = false) {
      let echo = { echo: false, ignore: false }
      if (verbose) {
         echo = { echo: true, ignore: false }
         console.log('ovary: makeIso')
      }
      console.log(cmd)

      Utils.writeX(`${this.settings.work_dir.path}mkisofs`, cmd)
      if (!scriptOnly) {
         await exec(cmd, echo)
      }
   }

   /**
    * finished = show the results
    * @param scriptOnly 
    */
   finished(scriptOnly = false) {
      Utils.titles('produce')
      if (!scriptOnly) {
         console.log('eggs is finished!\n\nYou can find the file iso: ' + chalk.cyanBright(this.settings.isoFilename) + '\nin the nest: ' + chalk.cyanBright(this.settings.config.snapshot_dir) + '.')
      } else {
         console.log('eggs is finished!\n\nYou can find the scripts to build iso: ' + chalk.cyanBright(this.settings.isoFilename) + '\nin the ovarium: ' + chalk.cyanBright(this.settings.work_dir.path) + '.')
         console.log(`usage`)
         console.log(chalk.cyanBright(`cd ${this.settings.work_dir.path}`))
         console.log(chalk.cyanBright(`sudo ./bind`))
         console.log(`Make all yours modifications in the directories filesystem.squashfs and iso.`)
         console.log(`After when you are ready:`)
         console.log(chalk.cyanBright(`sudo ./mksquashfs`))
         console.log(chalk.cyanBright(`sudo ./mkisofs`))
         console.log(chalk.cyanBright(`sudo ./ubind`))
         console.log(`happy hacking!`)
      }
      console.log()
      console.log('Remember, on liveCD user =' + chalk.cyanBright(this.settings.config.user_opt) + '/' + chalk.cyanBright(this.settings.config.user_opt_passwd))
      console.log('                    root =' + chalk.cyanBright('root') + '/' + chalk.cyanBright(this.settings.config.root_passwd))
   }


}

/**
 * Crea il path se non esiste
 * @param path
 */
async function makeIfNotExist(path: string, verbose = false): Promise<string> {
   if (verbose) {
      console.log(`ovary: makeIfNotExist(${path})`)
   }
   const echo = Utils.setEcho(verbose)
   let cmd = `# ${path} alreasy exist`
   if (!fs.existsSync(path)) {
      cmd = `mkdir ${path} -p`
      await exec(cmd, echo)
   }
   return cmd
}

/**
 *
 * @param cmd
 * @param echo
 */
async function rexec(cmd: string, verbose = false): Promise<string> {
   const echo = Utils.setEcho(verbose)

   await exec(cmd, echo)
   return cmd
}
