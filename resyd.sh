#!/bin/sh
clear
echo "Re-onstall Eggs Saving Yolk... Developer"
# yolk-restore
sudo rm /var/local/yolk.saved -rf
sudo mv /var/local/yolk /var/local/yolk.saved
# removing eggs
sudo apt purge eggs -y
sudo dpkg -i perrisbrewery/workdir/eggs_*_amd64.deb
# yolk-restore
sudo rm /var/local/yolk -rf
sudo mv /var/local/yolk.saved /var/local/yolk
sudo eggs dad -d


