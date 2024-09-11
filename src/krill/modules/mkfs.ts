/**
 * ./src/krill/modules/mkfs.ts
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
 * mkfs
 * 
 * mke2fs - create an ext2/ext3/ext4 file system -F force, -t type
 */
export default async function mkfs(this: Sequence): Promise<boolean> {
  const result = true

  if (this.partitions.filesystemType === 'ext4') {
    if (this.efi) {
      await exec(`mkdosfs -F 32 -I ${this.devices.efi.name} ${this.toNull}`, this.echo)
    }

    if (this.devices.boot.name !== 'none') {
      if (this.devices.boot.fsType === undefined) {
        this.devices.boot.fsType = 'ext2'
        this.devices.boot.mountPoint = '/boot'
      }
      await exec(`mke2fs -Ft ${this.devices.boot.fsType} ${this.devices.boot.name} ${this.toNull}`, this.echo)
    }

    if (this.devices.root.name !== 'none') {
      await exec(`mke2fs -Ft ${this.devices.root.fsType} ${this.devices.root.name} ${this.toNull}`, this.echo)
    }

    if (this.devices.data.name !== 'none') {
      await exec(`mke2fs -Ft ${this.devices.data.fsType} ${this.devices.data.name} ${this.toNull}`, this.echo)
    }

    if (this.devices.swap.name !== 'none') {
      await exec(`mkswap ${this.devices.swap.name} ${this.toNull}`, this.echo)
    }
  } else if (this.partitions.filesystemType === 'btrfs') {
    await exec(`mkfs.btrfs -f ${this.devices.root.name} ${this.toNull}`, this.echo)
    //  create subvolumes
    // await exec(`btrfs subvolume create /.snapshots ${this.toNull}`, this.echo)
    // await exec(`btrfs subvolume create /home ${this.toNull}`, this.echo)
    // await exec(`btrfs subvolume create /root ${this.toNull}`, this.echo)
    // await exec(`btrfs subvolume create /var/log ${this.toNull}`, this.echo)
    // await exec(`btrfs subvolume create /var/lib/AccountsService ${this.toNull}`, this.echo)
    // await exec(`btrfs subvolume create /var/lib/blueman ${this.toNull}`, this.echo)
    // await exec(`btrfs subvolume create /tmp ${this.toNull}`, this.echo)
  }

  return result
}
