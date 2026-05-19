$target = 'D:\GoogleDownload\completed_homework_structural_patterns_2.docx'
$source = Get-ChildItem 'D:\GoogleDownload' -Filter *.docx |
    Where-Object { $_.FullName -ne $target } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if ($null -eq $source) {
    throw 'No source DOCX found in D:\GoogleDownload'
}
Copy-Item -LiteralPath $source.FullName -Destination $target -Force

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipMode = [System.IO.Compression.ZipArchiveMode]::Update
$zip = [System.IO.Compression.ZipFile]::Open($target, $zipMode)

try {
    $entry = $zip.GetEntry('word/document.xml')
    if ($null -eq $entry) {
        throw 'word/document.xml not found'
    }

    $reader = New-Object System.IO.StreamReader($entry.Open())
    $xmlText = $reader.ReadToEnd()
    $reader.Close()

    [xml]$xml = $xmlText
    $nsUri = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    $ns = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
    $ns.AddNamespace('w', $nsUri)
    $body = $xml.SelectSingleNode('//w:body', $ns)
    if ($null -eq $body) {
        throw 'document body not found'
    }

    function New-ParagraphNode {
        param(
            [Parameter(Mandatory = $true)][xml]$DocumentXml,
            [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text,
            [switch]$Bold,
            [switch]$Code
        )

        $p = $DocumentXml.CreateElement('w', 'p', $nsUri)
        $r = $DocumentXml.CreateElement('w', 'r', $nsUri)

        $rPr = $DocumentXml.CreateElement('w', 'rPr', $nsUri)
        if ($Bold.IsPresent) {
            $b = $DocumentXml.CreateElement('w', 'b', $nsUri)
            $rPr.AppendChild($b) | Out-Null
        }

        $rFonts = $DocumentXml.CreateElement('w', 'rFonts', $nsUri)
        if ($Code.IsPresent) {
            $rFonts.SetAttribute('ascii', $nsUri, 'Consolas')
            $rFonts.SetAttribute('hAnsi', $nsUri, 'Consolas')
        }
        else {
            $rFonts.SetAttribute('ascii', $nsUri, 'Arial')
            $rFonts.SetAttribute('hAnsi', $nsUri, 'Arial')
        }
        $rPr.AppendChild($rFonts) | Out-Null

        $sz = $DocumentXml.CreateElement('w', 'sz', $nsUri)
        if ($Code.IsPresent) {
            $sz.SetAttribute('val', $nsUri, '20')
        }
        elseif ($Bold.IsPresent) {
            $sz.SetAttribute('val', $nsUri, '24')
        }
        else {
            $sz.SetAttribute('val', $nsUri, '22')
        }
        $rPr.AppendChild($sz) | Out-Null
        $r.AppendChild($rPr) | Out-Null

        $t = $DocumentXml.CreateElement('w', 't', $nsUri)
        if ($Text.StartsWith(' ') -or $Text.EndsWith(' ') -or $Text.Contains('  ')) {
            $spaceAttr = $DocumentXml.CreateAttribute('xml', 'space', 'http://www.w3.org/XML/1998/namespace')
            $spaceAttr.Value = 'preserve'
            $t.Attributes.Append($spaceAttr) | Out-Null
        }
        $t.InnerText = $Text
        $r.AppendChild($t) | Out-Null
        $p.AppendChild($r) | Out-Null
        return $p
    }

    function Append-Line {
        param(
            [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text,
            [switch]$Bold,
            [switch]$Code
        )
        $node = @(New-ParagraphNode -DocumentXml $xml -Text $Text -Bold:$Bold.IsPresent -Code:$Code.IsPresent)[-1]
        $body.AppendChild($node) | Out-Null
    }

    $lines = @(
        @{ Text = '' },
        @{ Text = '4. Answers'; Bold = $true },
        @{ Text = 'Question 1: Composite Pattern Design'; Bold = $true },
        @{ Text = 'Idea: Define a unified abstract component named Control. Button and TextBox are leaf objects. Form and Panel are container objects. A container stores child controls, so the client can treat a single control and a group of controls uniformly.' },
        @{ Text = 'Class diagram (text version):' },
        @{ Text = '+--------------------+'; Code = $true },
        @{ Text = '|      Control       |'; Code = $true },
        @{ Text = '+--------------------+'; Code = $true },
        @{ Text = '| +display()         |'; Code = $true },
        @{ Text = '| +add(c: Control)   |'; Code = $true },
        @{ Text = '| +remove(c: Control)|'; Code = $true },
        @{ Text = '| +getChild(i:int)   |'; Code = $true },
        @{ Text = '+--------------------+'; Code = $true },
        @{ Text = '          ^'; Code = $true },
        @{ Text = '          |'; Code = $true },
        @{ Text = '   -------------------------'; Code = $true },
        @{ Text = '   |                       |'; Code = $true },
        @{ Text = '+---------+         +----------------+'; Code = $true },
        @{ Text = '| Button  |         |   Container    |'; Code = $true },
        @{ Text = '+---------+         +----------------+'; Code = $true },
        @{ Text = '|display()|         | -children: List|'; Code = $true },
        @{ Text = '+---------+         | +display()     |'; Code = $true },
        @{ Text = '                    | +add(Control)  |'; Code = $true },
        @{ Text = '+---------+         | +remove(Control)|'; Code = $true },
        @{ Text = '| TextBox |         | +getChild(int) |'; Code = $true },
        @{ Text = '+---------+         +----------------+'; Code = $true },
        @{ Text = '|display()|                 ^'; Code = $true },
        @{ Text = '+---------+                 |'; Code = $true },
        @{ Text = '                    ------------------'; Code = $true },
        @{ Text = '                    |                |'; Code = $true },
        @{ Text = '                 +------+        +-------+'; Code = $true },
        @{ Text = '                 | Form |        | Panel |'; Code = $true },
        @{ Text = '                 +------+        +-------+'; Code = $true },
        @{ Text = 'Design principles:' },
        @{ Text = '1. Single Responsibility Principle: each concrete control focuses on its own display behavior.' },
        @{ Text = '2. Open Closed Principle: new controls can be added without changing client code.' },
        @{ Text = '3. Liskov Substitution Principle: all concrete controls can be used wherever Control is expected.' },
        @{ Text = '4. Dependency Inversion Principle: the client depends on Control instead of specific controls.' },
        @{ Text = '5. Interface Segregation Principle: the external interface stays small and consistent.' },
        @{ Text = '6. Law of Demeter: a container interacts directly with its immediate children.' },
        @{ Text = '7. Composite Reuse Principle: complex interfaces are built through object composition.' },
        @{ Text = 'Question 2: Decorator Pattern Design and Java Implementation'; Bold = $true },
        @{ Text = 'Idea: Beverage is the abstract component. Espresso, HouseBlend, and DarkRoast are concrete beverages. CondimentDecorator is the abstract decorator that wraps a Beverage object. Milk, Mocha, and Whip are concrete decorators. The total description and cost are built dynamically at runtime.' },
        @{ Text = 'Class diagram (text version):' },
        @{ Text = '+------------------------------+'; Code = $true },
        @{ Text = '|          Beverage            |'; Code = $true },
        @{ Text = '+------------------------------+'; Code = $true },
        @{ Text = '| +getDescription(): String    |'; Code = $true },
        @{ Text = '| +getCost(): double           |'; Code = $true },
        @{ Text = '+------------------------------+'; Code = $true },
        @{ Text = '             ^'; Code = $true },
        @{ Text = '             |'; Code = $true },
        @{ Text = '  -------------------------------------------'; Code = $true },
        @{ Text = '  |                    |                    |'; Code = $true },
        @{ Text = '+-----------+   +---------------+   +--------------+'; Code = $true },
        @{ Text = '| Espresso  |   | HouseBlend    |   | DarkRoast    |'; Code = $true },
        @{ Text = '+-----------+   +---------------+   +--------------+'; Code = $true },
        @{ Text = '             ^'; Code = $true },
        @{ Text = '             |'; Code = $true },
        @{ Text = '+------------------------------+'; Code = $true },
        @{ Text = '|     CondimentDecorator       |'; Code = $true },
        @{ Text = '+------------------------------+'; Code = $true },
        @{ Text = '| -beverage: Beverage          |'; Code = $true },
        @{ Text = '+------------------------------+'; Code = $true },
        @{ Text = '             ^'; Code = $true },
        @{ Text = '             |'; Code = $true },
        @{ Text = '   -----------------------------'; Code = $true },
        @{ Text = '   |             |             |'; Code = $true },
        @{ Text = '+-------+    +--------+    +------+'; Code = $true },
        @{ Text = '| Milk  |    | Mocha  |    | Whip |'; Code = $true },
        @{ Text = '+-------+    +--------+    +------+'; Code = $true },
        @{ Text = 'Java code:'; Bold = $true },
        @{ Text = 'abstract class Beverage {'; Code = $true },
        @{ Text = '    public abstract String getDescription();'; Code = $true },
        @{ Text = '    public abstract double getCost();'; Code = $true },
        @{ Text = '}'; Code = $true },
        @{ Text = ''; Code = $true },
        @{ Text = 'class Espresso extends Beverage {'; Code = $true },
        @{ Text = '    public String getDescription() {'; Code = $true },
        @{ Text = '        return "Espresso Coffee";'; Code = $true },
        @{ Text = '    }'; Code = $true },
        @{ Text = '    public double getCost() {'; Code = $true },
        @{ Text = '        return 25.0;'; Code = $true },
        @{ Text = '    }'; Code = $true },
        @{ Text = '}'; Code = $true },
        @{ Text = ''; Code = $true },
        @{ Text = 'class HouseBlend extends Beverage {'; Code = $true },
        @{ Text = '    public String getDescription() {'; Code = $true },
        @{ Text = '        return "House Blend Coffee";'; Code = $true },
        @{ Text = '    }'; Code = $true },
        @{ Text = '    public double getCost() {'; Code = $true },
        @{ Text = '        return 30.0;'; Code = $true },
        @{ Text = '    }'; Code = $true },
        @{ Text = '}'; Code = $true },
        @{ Text = ''; Code = $true },
        @{ Text = 'class DarkRoast extends Beverage {'; Code = $true },
        @{ Text = '    public String getDescription() {'; Code = $true },
        @{ Text = '        return "Dark Roast Coffee";'; Code = $true },
        @{ Text = '    }'; Code = $true },
        @{ Text = '    public double getCost() {'; Code = $true },
        @{ Text = '        return 20.0;'; Code = $true },
        @{ Text = '    }'; Code = $true },
        @{ Text = '}'; Code = $true },
        @{ Text = ''; Code = $true },
        @{ Text = 'abstract class CondimentDecorator extends Beverage {'; Code = $true },
        @{ Text = '    protected Beverage beverage;'; Code = $true },
        @{ Text = '    public CondimentDecorator(Beverage beverage) {'; Code = $true },
        @{ Text = '        this.beverage = beverage;'; Code = $true },
        @{ Text = '    }'; Code = $true },
        @{ Text = '}'; Code = $true },
        @{ Text = ''; Code = $true },
        @{ Text = 'class Milk extends CondimentDecorator {'; Code = $true },
        @{ Text = '    public Milk(Beverage beverage) {'; Code = $true },
        @{ Text = '        super(beverage);'; Code = $true },
        @{ Text = '    }'; Code = $true },
        @{ Text = '    public String getDescription() {'; Code = $true },
        @{ Text = '        return beverage.getDescription() + " + Milk";'; Code = $true },
        @{ Text = '    }'; Code = $true },
        @{ Text = '    public double getCost() {'; Code = $true },
        @{ Text = '        return beverage.getCost() + 6.0;'; Code = $true },
        @{ Text = '    }'; Code = $true },
        @{ Text = '}'; Code = $true },
        @{ Text = ''; Code = $true },
        @{ Text = 'class Mocha extends CondimentDecorator {'; Code = $true },
        @{ Text = '    public Mocha(Beverage beverage) {'; Code = $true },
        @{ Text = '        super(beverage);'; Code = $true },
        @{ Text = '    }'; Code = $true },
        @{ Text = '    public String getDescription() {'; Code = $true },
        @{ Text = '        return beverage.getDescription() + " + Mocha";'; Code = $true },
        @{ Text = '    }'; Code = $true },
        @{ Text = '    public double getCost() {'; Code = $true },
        @{ Text = '        return beverage.getCost() + 10.0;'; Code = $true },
        @{ Text = '    }'; Code = $true },
        @{ Text = '}'; Code = $true },
        @{ Text = ''; Code = $true },
        @{ Text = 'class Whip extends CondimentDecorator {'; Code = $true },
        @{ Text = '    public Whip(Beverage beverage) {'; Code = $true },
        @{ Text = '        super(beverage);'; Code = $true },
        @{ Text = '    }'; Code = $true },
        @{ Text = '    public String getDescription() {'; Code = $true },
        @{ Text = '        return beverage.getDescription() + " + Whip";'; Code = $true },
        @{ Text = '    }'; Code = $true },
        @{ Text = '    public double getCost() {'; Code = $true },
        @{ Text = '        return beverage.getCost() + 8.0;'; Code = $true },
        @{ Text = '    }'; Code = $true },
        @{ Text = '}'; Code = $true },
        @{ Text = ''; Code = $true },
        @{ Text = 'public class CoffeeShop {'; Code = $true },
        @{ Text = '    public static void printDrink(Beverage beverage) {'; Code = $true },
        @{ Text = '        System.out.println("Drink: " + beverage.getDescription());'; Code = $true },
        @{ Text = '        System.out.println("Price: " + beverage.getCost());'; Code = $true },
        @{ Text = '        System.out.println("---------------------");'; Code = $true },
        @{ Text = '    }'; Code = $true },
        @{ Text = ''; Code = $true },
        @{ Text = '    public static void main(String[] args) {'; Code = $true },
        @{ Text = '        Beverage b1 = new Espresso();'; Code = $true },
        @{ Text = '        Beverage b2 = new Milk(new Espresso());'; Code = $true },
        @{ Text = '        Beverage b3 = new Mocha(new Milk(new Espresso()));'; Code = $true },
        @{ Text = '        Beverage b4 = new Whip(new DarkRoast());'; Code = $true },
        @{ Text = '        Beverage b5 = new Whip(new Mocha(new HouseBlend()));'; Code = $true },
        @{ Text = ''; Code = $true },
        @{ Text = '        printDrink(b1);'; Code = $true },
        @{ Text = '        printDrink(b2);'; Code = $true },
        @{ Text = '        printDrink(b3);'; Code = $true },
        @{ Text = '        printDrink(b4);'; Code = $true },
        @{ Text = '        printDrink(b5);'; Code = $true },
        @{ Text = '    }'; Code = $true },
        @{ Text = '}'; Code = $true },
        @{ Text = 'Sample output:'; Bold = $true },
        @{ Text = 'Drink: Espresso Coffee'; Code = $true },
        @{ Text = 'Price: 25.0'; Code = $true },
        @{ Text = '---------------------'; Code = $true },
        @{ Text = 'Drink: Espresso Coffee + Milk'; Code = $true },
        @{ Text = 'Price: 31.0'; Code = $true },
        @{ Text = '---------------------'; Code = $true },
        @{ Text = 'Drink: Espresso Coffee + Milk + Mocha'; Code = $true },
        @{ Text = 'Price: 41.0'; Code = $true },
        @{ Text = '---------------------'; Code = $true },
        @{ Text = 'Drink: Dark Roast Coffee + Whip'; Code = $true },
        @{ Text = 'Price: 28.0'; Code = $true },
        @{ Text = '---------------------'; Code = $true },
        @{ Text = 'Drink: House Blend Coffee + Mocha + Whip'; Code = $true },
        @{ Text = 'Price: 48.0'; Code = $true },
        @{ Text = '---------------------'; Code = $true },
        @{ Text = 'Conclusion: The composite pattern allows a single control and a group of controls to be handled in a unified way. The decorator pattern allows condiments to be added flexibly without creating many subclasses, which improves extensibility and reuse.' }
    )

    foreach ($line in $lines) {
        Append-Line -Text $line.Text -Bold:([bool]$line.Bold) -Code:([bool]$line.Code)
    }

    $tempPath = Join-Path $env:TEMP ([System.Guid]::NewGuid().ToString() + '.xml')
    $xml.Save($tempPath)

    $entry.Delete()
    $newEntry = $zip.CreateEntry('word/document.xml')
    $writer = New-Object System.IO.StreamWriter($newEntry.Open())
    $writer.Write([System.IO.File]::ReadAllText($tempPath))
    $writer.Close()
    Remove-Item $tempPath -Force

    Write-Output "DONE: $target"
}
finally {
    $zip.Dispose()
}
