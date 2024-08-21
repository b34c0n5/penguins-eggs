/**
 * ./src/krill/modules/add-user.ts
 * penguins-eggs v.10.0.0 / ecmascript 2020
 * author: Piero Proietti
 * email: piero.proietti@gmail.com
 * license: MIT
 * https://stackoverflow.com/questions/23876782/how-do-i-split-a-typescript-class-into-multiple-files
 */

import Utils from '../../classes/utils.js'
import { exec } from '../../lib/utils.js'
import Sequence from '../sequence.js'

/**
 *
 * @param this
 * @param name
 * @param password
 * @param fullName
 * @param roomNumber
 * @param workPhone
 * @param homePhone
 */
export default async function addUser(this: Sequence, name = 'live', password = 'evolution', fullName = '', roomNumber = '', workPhone = '', homePhone = ''): Promise<void> {
  // adduser user
  let cmd = `chroot ${this.installTarget} adduser ${name} --home /home/${name} --shell /bin/bash --disabled-password --gecos "${fullName},${roomNumber},${workPhone},${homePhone}" ${this.toNull}`
  if (this.distro.familyId === 'archlinux') {
    cmd = `chroot ${this.installTarget} useradd --create-home --shell /bin/bash ${name} ${this.toNull}`
  }

  await exec(cmd, this.echo)

  // chapasswd user
  cmd = `echo ${name}:${password} | chroot ${this.installTarget} chpasswd ${this.toNull}`
  await exec(cmd, this.echo)

  // sudo ot wheel
  let group = 'sudo'
  if (this.distro.familyId === 'archlinux' || this.distro.familyId === 'alpine') {
    group = 'wheel'
  }

  cmd = `chroot ${this.installTarget} usermod -aG ${group} ${name} ${this.toNull}`
  await exec(cmd, this.echo)

  // autologin
  try {
    await exec(cmd, this.echo)
    if (this.distro.familyId === 'archlinux') {
      await exec(`chroot ${this.installTarget} getent group autologin || groupadd autologin`)
      await exec(`chroot ${this.installTarget} gpasswd -a ${this.settings.config.user_opt} autologin`)
    }
  } catch {
    await Utils.pressKeyToExit(cmd)
  }
}
