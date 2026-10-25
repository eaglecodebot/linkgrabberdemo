$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System.Windows.Forms;
public class QuietNotification : Form {
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams { get { var p = base.CreateParams; p.ExStyle |= 0x08000000; return p; } }
}
'@
$form = New-Object QuietNotification
$form.FormBorderStyle = 'None'
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.StartPosition = 'Manual'
$form.BackColor = [System.Drawing.Color]::FromArgb(18,82,63)
$form.ClientSize = New-Object System.Drawing.Size(390,145)
$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form.Location = New-Object System.Drawing.Point(($area.Right - 406),($area.Bottom - 161))
$title = New-Object System.Windows.Forms.Label
$title.Location = New-Object System.Drawing.Point(18,16)
$title.Size = New-Object System.Drawing.Size(350,28)
$title.Font = New-Object System.Drawing.Font('Segoe UI',12,[System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::White
$title.Text = $payload.title
$message = New-Object System.Windows.Forms.Label
$message.Location = New-Object System.Drawing.Point(18,50)
$message.Size = New-Object System.Drawing.Size(350,77)
$message.Font = New-Object System.Drawing.Font('Segoe UI',10)
$message.ForeColor = [System.Drawing.Color]::White
$message.Text = $payload.message
$form.Controls.AddRange(@($title,$message))
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 6000
$timer.Add_Tick({ $timer.Stop(); $form.Close() })
$form.Add_Shown({ $timer.Start() })
$form.Add_Click({ $form.Close() })
[System.Windows.Forms.Application]::Run($form)
$timer.Dispose()
$form.Dispose()
